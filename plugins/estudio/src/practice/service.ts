import type { PluginInference } from 'learnharness-plugin-api';
import { localDate } from '../assessment/calendar.ts';
import { fields, id, text } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError, type StudyUnit } from '../study/types.ts';
import { inArea, type AreaFilter } from '../study/areas.ts';
import { abandon, addJudgment, freeze, grade, openSource, publicAttempt, revealCue, saveAnswer, type PublicAttempt } from './attempts.ts';
import { generateTask, judgeAttempt, scaffoldOwnTask, type GeneratedTask } from './model.ts';
import { dailyQueue, regulate, type TraceEntry, type UnitRegulation } from './policy.ts';
import { unitStage, type UnitStage } from './stage.ts';
import { failureType, fidelity, LIMITS, MAX_EXPOSURES, use } from './schema.ts';
import type { FailureType, PracticeAttempt } from './types.ts';

export interface TodayItem extends UnitRegulation { title: string }
export interface Today { queue: TodayItem[]; open: PublicAttempt[] }
export interface FrozenResult { attempt: PublicAttempt; warning: string | null }
/** One active unit as the route shows it: its stage, when it is due and what comes next. */
export interface UnitOverview extends UnitRegulation { title: string; stage: UnitStage; graded: number; lastGradedAt: string | null; open: boolean }
/** A unit with every graded attempt and what the regulator did with it, newest first. */
export interface UnitProgress extends UnitOverview { trace: TraceEntry[] }
/** Confidence declared before eligible attempts against recall without help: Brier 0 is perfect, 0.25 is a coin. */
export interface Calibration { attempts: number; brier: number; meanConfidence: number; successRate: number }
export interface Progress {
  units: UnitProgress[];
  calibration: Calibration | null;
  failures: Partial<Record<FailureType, number>>;
}

export interface PracticeService {
  /** Each of these reads the units of one space, or of all when the filter is null or absent. */
  today(filter?: AreaFilter): Today;
  overview(filter?: AreaFilter): UnitOverview[];
  progress(filter?: AreaFilter): Progress;
  /** One attempt as the attempt screen shows it, to resume or review it; reveals nothing the attempt has not reached. */
  attempt(input: unknown): PublicAttempt;
  start(input: unknown): Promise<PublicAttempt>;
  /** A retrieval question David wrote, practised like any task: same attempt, same evidence. */
  startOwn(input: unknown): Promise<PublicAttempt>;
  cue(input: unknown): PublicAttempt;
  openSource(input: unknown): Promise<FrozenResult>;
  saveAnswer(input: unknown): PublicAttempt;
  freeze(input: unknown): Promise<FrozenResult>;
  grade(input: unknown): PublicAttempt;
  abandon(input: unknown): PublicAttempt;
  /** A native session turn in a chat a unit came from exposes that unit. */
  recordSessionExposure(chatId: string): number;
}

export interface PracticeOptions {
  inference: PluginInference;
  now: () => string;
  newId: () => string;
  timeZone: string;
  signal: AbortSignal;
  dailyCap?: number;
  /** Text of the unit's incorporated sources, capped for the prompt; null when it has none. */
  sourceExcerpt?: (unit: StudyUnit) => string | null;
}

const PREVIOUS_PROMPTS = 10;

export function createPracticeService(store: StudyStore, options: PracticeOptions): PracticeService {
  const { inference, now, newId, timeZone, signal } = options;

  function activeUnit(unitId: string): StudyUnit {
    const unit = store.getUnit(unitId);
    if (!unit) throw new StudyError('NOT_FOUND', `Unit ${unitId} does not exist`);
    if (unit.status !== 'activa') throw new StudyError('INVALID_TRANSITION', `Unit ${unitId} is ${unit.status}`);
    return unit;
  }

  function loadAttempt(input: unknown, extra: readonly string[] = []): { attempt: PracticeAttempt; rest: Record<string, unknown> } {
    const r = fields(input, ['attemptId', ...extra], 'input');
    const attemptId = id(r.attemptId, 'input.attemptId');
    const attempt = store.getAttempt(attemptId);
    if (!attempt) throw new StudyError('NOT_FOUND', `Attempt ${attemptId} does not exist`);
    return { attempt, rest: r };
  }

  function view(attempt: PracticeAttempt): PublicAttempt {
    const task = store.getTask(attempt.taskId);
    if (!task) throw new StudyError('CORRUPT_DATA', `Task ${attempt.taskId} of attempt ${attempt.id} is missing`);
    return publicAttempt(attempt, task);
  }

  function persist(previous: PracticeAttempt, next: PracticeAttempt): PublicAttempt {
    return view(store.saveAttempt(next, previous.revision));
  }

  function expose(unitId: string, at: string): void {
    const current = store.getExposures(unitId);
    const instants = [...(current?.instants ?? []), at].slice(-MAX_EXPOSURES);
    store.saveExposures({ id: unitId, revision: (current?.revision ?? 0) + 1, instants }, current?.revision ?? null);
  }

  /** Freezes, records the contrast as an exposure and asks for the model's judgment. Never throws after freezing:
   * the attempt is already final, so a failed judgment becomes a warning and David grades on his own. */
  async function freezeAndJudge(attempt: PracticeAttempt): Promise<FrozenResult> {
    const at = now();
    const frozen = store.saveAttempt(freeze(attempt, at), attempt.revision);
    expose(attempt.unitId, at);
    try {
      const unit = store.getUnit(frozen.unitId);
      const excerpt = unit ? options.sourceExcerpt?.(unit) ?? null : null;
      const judgment = await judgeAttempt(inference, store.getTask(frozen.taskId)!, frozen.answer, now(), signal, excerpt);
      const current = store.getAttempt(frozen.id)!;
      return { attempt: view(store.saveAttempt(addJudgment(current, judgment), current.revision)), warning: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { attempt: view(store.getAttempt(frozen.id)!), warning: `No se pudo obtener el contraste del modelo (${message}). Puedes autoevaluar igualmente.` };
    }
  }

  function regulation(unit: StudyUnit): UnitRegulation {
    return regulate(unit, store.listAttempts(unit.id), store.getExposures(unit.id)?.instants ?? [], now(), timeZone);
  }

  const unfinished = (a: PracticeAttempt) => a.status === 'open' || a.status === 'frozen';

  /** Resumes an unfinished attempt of the unit, or opens a new one on the task `make` produces. */
  async function begin(unit: StudyUnit, confidence: unknown, make: () => Promise<GeneratedTask>): Promise<PublicAttempt> {
    if (!Number.isSafeInteger(confidence) || (confidence as number) < 0 || (confidence as number) > 100) {
      throw new StudyError('INVALID_INPUT', 'confidence must be an integer in [0, 100]');
    }
    const resumable = store.listAttempts(unit.id).find(unfinished);
    if (resumable) return view(resumable);
    const generated = await make();
    if (signal.aborted) throw new StudyError('INVALID_TRANSITION', 'Estudio está desactivado.');
    const raced = store.listAttempts(unit.id).find(unfinished);
    if (raced) return view(raced);
    const at = now();
    const task = store.saveTask({ ...generated, id: newId(), revision: 1, unitId: unit.id, createdAt: at }, null);
    const attempt = store.saveAttempt({
      id: newId(), revision: 1, unitId: unit.id, taskId: task.id, taskKind: task.kind, openedAt: at, confidence: confidence as number,
      cueLevel: 0, cueLevelAtFreeze: null, answer: '', answerHash: null, frozenAt: null, status: 'open', contextLabel: task.kind, judgments: [], grades: [],
    }, null);
    return view(attempt);
  }

  return {
    today(filter = null) {
      const units = store.listUnits().filter(u => u.status === 'activa' && inArea(u, filter));
      const titles = new Map(units.map(u => [u.id, u.title]));
      const shown = new Set(store.listUnits().filter(u => inArea(u, filter)).map(u => u.id));
      const open = store.listAttempts().filter(a => unfinished(a) && shown.has(a.unitId));
      const busy = new Set(open.map(a => a.unitId));
      const queue = dailyQueue(units.map(regulation).filter(r => !busy.has(r.unitId)), localDate(now(), timeZone), options.dailyCap ?? 5);
      return { queue: queue.map(r => ({ ...r, title: titles.get(r.unitId) ?? r.unitId })), open: open.map(view) };
    },

    overview(filter = null) {
      const attempts = store.listAttempts();
      return store.listUnits().filter(u => u.status === 'activa' && inArea(u, filter)).map(unit => {
        const own = attempts.filter(a => a.unitId === unit.id);
        const graded = own.filter(a => a.status === 'graded' && a.grades.length > 0);
        const r = regulation(unit);
        return {
          ...r, title: unit.title, stage: unitStage(r, graded.length), graded: graded.length,
          lastGradedAt: graded.map(a => a.grades.at(-1)!.gradedAt).sort().at(-1) ?? null, open: own.some(unfinished),
        };
      });
    },

    progress(filter = null) {
      const attempts = store.listAttempts();
      const units = store.listUnits().filter(u => u.status === 'activa' && inArea(u, filter)).map(unit => {
        const own = attempts.filter(a => a.unitId === unit.id);
        const trace: TraceEntry[] = [];
        const r = regulate(unit, own, store.getExposures(unit.id)?.instants ?? [], now(), timeZone, trace);
        const graded = own.filter(a => a.status === 'graded' && a.grades.length > 0);
        return {
          ...r, title: unit.title, stage: unitStage(r, graded.length), graded: graded.length,
          lastGradedAt: graded.map(a => a.grades.at(-1)!.gradedAt).sort().at(-1) ?? null, open: own.some(unfinished), trace: trace.reverse(),
        };
      });
      const all = units.flatMap(u => u.trace);
      const eligible = all.filter(t => t.eligible);
      const calibration = eligible.length === 0 ? null : {
        attempts: eligible.length,
        brier: eligible.reduce((s, t) => s + (t.confidence / 100 - (t.success ? 1 : 0)) ** 2, 0) / eligible.length,
        meanConfidence: eligible.reduce((s, t) => s + t.confidence, 0) / eligible.length / 100,
        successRate: eligible.filter(t => t.success).length / eligible.length,
      };
      const failures: Partial<Record<FailureType, number>> = {};
      for (const t of all) if (t.failureType) failures[t.failureType] = (failures[t.failureType] ?? 0) + 1;
      return { units, calibration, failures };
    },

    attempt(input) {
      return view(loadAttempt(input).attempt);
    },

    async start(input) {
      const r = fields(input, ['unitId', 'confidence'], 'input');
      const unit = activeUnit(id(r.unitId, 'input.unitId'));
      return begin(unit, r.confidence, () => {
        const kind = regulation(unit).nextTaskKind;
        const previous = store.listTasks(unit.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PREVIOUS_PROMPTS).map(t => t.prompt);
        return generateTask(inference, unit, kind, previous, signal, options.sourceExcerpt?.(unit) ?? null);
      });
    },

    async startOwn(input) {
      const r = fields(input, ['unitId', 'confidence', 'question', 'answer'], 'input');
      const unit = activeUnit(id(r.unitId, 'input.unitId'));
      const question = text(r.question, LIMITS.prompt, 'input.question', { required: true }).trim();
      const answer = text(r.answer, LIMITS.reference, 'input.answer', { required: true }).trim();
      return begin(unit, r.confidence, () => scaffoldOwnTask(inference, question, answer, signal));
    },

    cue(input) {
      const { attempt } = loadAttempt(input);
      return persist(attempt, revealCue(attempt));
    },

    /** Opening the source ends retrieval: the attempt is frozen as not recalled and goes straight to the contrast. */
    async openSource(input) {
      const { attempt } = loadAttempt(input);
      const opened = store.saveAttempt(openSource(attempt), attempt.revision);
      return freezeAndJudge(opened);
    },

    saveAnswer(input) {
      const { attempt, rest } = loadAttempt(input, ['answer']);
      if (typeof rest.answer !== 'string') throw new StudyError('INVALID_INPUT', 'answer must be text');
      return persist(attempt, saveAnswer(attempt, rest.answer));
    },

    async freeze(input) {
      const { attempt } = loadAttempt(input);
      return freezeAndJudge(attempt);
    },

    grade(input) {
      const { attempt, rest } = loadAttempt(input, ['fidelity', 'use', 'failureType']);
      return persist(attempt, grade(attempt, {
        fidelity: fidelity(rest.fidelity, 'input.fidelity'),
        use: rest.use === undefined || rest.use === null ? null : use(rest.use, 'input.use'),
        failureType: failureType(rest.failureType ?? null, 'input.failureType'),
      }, now()));
    },

    abandon(input) {
      const { attempt } = loadAttempt(input);
      return persist(attempt, abandon(attempt));
    },

    recordSessionExposure(chatId) {
      const at = now();
      const units = store.listUnits().filter(u => u.status === 'activa' && u.origin.chatId === chatId);
      for (const unit of units) expose(unit.id, at);
      return units.length;
    },
  };
}
