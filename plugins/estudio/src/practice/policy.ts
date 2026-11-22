import { addDays, instantMillis, localDate } from '../assessment/calendar.ts';
import type { StudyUnit, UnitPolicy } from '../study/types.ts';
import { SOURCE_OPENED, type FailureType, type PracticeAttempt, type TaskKind } from './types.ts';

/** Days per interval step; step -1 (relearning) uses one day. */
export const INTERVALS = [2, 7, 21, 60] as const;
export const RELEARN_DAYS = 1;
export const MAINTENANCE_DAYS = 90;
const ELIGIBILITY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TASK: Record<UnitPolicy, TaskKind> = { recordar: 'guiada', reconstruir: 'libre', ejecutar: 'aplicada', localizar: 'guiada' };

const TASK_FOR_FAILURE: Record<FailureType, TaskKind> = {
  acceso: 'guiada', precision: 'libre', estructural: 'estructural',
  discriminacion: 'comparacion', aplicacion: 'aplicada', transferencia: 'transferencia',
};

export type Access = 0 | 1 | 2 | 3;

export function accessFromCue(level: number): Access {
  if (level >= SOURCE_OPENED) return 0;
  if (level >= 3) return 1;
  if (level >= 1) return 2;
  return 3;
}

export interface UnitRegulation {
  unitId: string;
  since: string;
  mode: 'cola' | 'mantenimiento' | 'fuera';
  step: number;
  dueDate: string | null;
  nextTaskKind: TaskKind;
  needsVerification: boolean;
  eligibleCount: number;
  lastFailure: FailureType | null;
  brier: number | null;
}

/** What the regulator did with one graded attempt, in order; it explains why a review is due when it is. */
export type TraceEffect = 'practica' | 'reaprender' | 'intervalo' | 'repetir' | 'verificar' | 'mantenimiento';
export interface TraceEntry {
  attemptId: string;
  at: string;
  day: string;
  taskKind: TaskKind;
  confidence: number;
  access: Access;
  fidelity: number;
  modelFidelity: number | null;
  failureType: FailureType | null;
  eligible: boolean;
  success: boolean;
  effect: TraceEffect;
  /** Days until the review this attempt set; for practice, only when it brought the review forward. */
  days: number | null;
  nextTaskKind: TaskKind;
}

/** The unit's policy, or the one its kind of knowledge implies: a procedure is practised by executing it. */
export function effectivePolicy(unit: Pick<StudyUnit, 'policy' | 'kind'>): UnitPolicy {
  return unit.policy ?? (unit.kind === 'procedimiento' ? 'ejecutar' : 'reconstruir');
}

function intervalDays(step: number): number {
  return step < 0 ? RELEARN_DAYS : INTERVALS[Math.min(step, INTERVALS.length - 1)]!;
}

function earlier(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

/** Eligible when no exposure of the unit happened from 24 hours before opening until freezing. */
export function isEligible(attempt: PracticeAttempt, exposures: readonly string[]): boolean {
  const opened = instantMillis(attempt.openedAt);
  const frozen = instantMillis(attempt.frozenAt ?? attempt.openedAt);
  return !exposures.map(instantMillis).some(t => t > opened - ELIGIBILITY_MS && t < frozen);
}

/** Replays every graded attempt of a unit under policy v2. Nothing scheduled is stored. */
export function regulate(unit: StudyUnit, attempts: readonly PracticeAttempt[], exposures: readonly string[], now: string, timeZone: string, trace?: TraceEntry[]): UnitRegulation {
  const defaultKind = DEFAULT_TASK[effectivePolicy(unit)];
  const base: UnitRegulation = {
    unitId: unit.id, since: unit.createdAt, mode: 'cola', step: -1, dueDate: null, nextTaskKind: defaultKind,
    needsVerification: false, eligibleCount: 0, lastFailure: null, brier: null,
  };
  if (unit.status !== 'activa' || unit.policy === 'localizar') return { ...base, mode: 'fuera' };

  const graded = attempts
    .filter(a => a.unitId === unit.id && a.status === 'graded' && a.frozenAt !== null && a.cueLevelAtFreeze !== null)
    .sort((a, b) => a.frozenAt!.localeCompare(b.frozenAt!) || a.id.localeCompare(b.id));

  const state = { ...base };
  let brierSum = 0;
  /** Use measured in the latest eligible applied case; null until there is one. */
  let lastAppliedUse: number | null = null;
  const usedInContexts = new Set<string>();

  for (const attempt of graded) {
    const grade = attempt.grades.at(-1)!;
    const day = localDate(attempt.frozenAt!, timeZone);
    const access = accessFromCue(attempt.cueLevelAtFreeze!);
    const success = access === 3 && grade.fidelity === 3;
    const judgment = attempt.judgments.at(-1);
    const disputed = judgment !== undefined && Math.abs(judgment.fidelity - grade.fidelity) >= 2;
    if (grade.failureType) state.lastFailure = grade.failureType;
    const entry = (eligible: boolean, effect: TraceEffect, days: number | null) => trace?.push({
      attemptId: attempt.id, at: attempt.frozenAt!, day, taskKind: attempt.taskKind, confidence: attempt.confidence, access, fidelity: grade.fidelity,
      modelFidelity: judgment?.fidelity ?? null, failureType: grade.failureType, eligible, success, effect, days, nextTaskKind: state.nextTaskKind,
    });

    if (!isEligible(attempt, exposures)) {
      // Practice: it can only bring the next review forward, never earn an interval.
      if (!success) state.dueDate = earlier(state.dueDate, addDays(day, RELEARN_DAYS));
      if (grade.failureType) state.nextTaskKind = TASK_FOR_FAILURE[grade.failureType];
      entry(false, 'practica', success ? null : RELEARN_DAYS);
      continue;
    }

    state.eligibleCount++;
    brierSum += (attempt.confidence / 100 - (success ? 1 : 0)) ** 2;
    state.needsVerification = disputed;

    if (access <= 1) state.step = -1;
    else if (success) state.step = Math.min(state.step + 1, INTERVALS.length - 1);
    state.dueDate = addDays(day, disputed ? RELEARN_DAYS : intervalDays(state.step));

    if (attempt.taskKind === 'aplicada' && grade.use !== null) lastAppliedUse = grade.use;
    if (attempt.taskKind === 'aplicada' && grade.use === 2) usedInContexts.add(attempt.taskId);
    // Maintenance by use has to be kept up: any review that is not a full success earns it again from zero.
    if (!success) usedInContexts.clear();
    if (grade.failureType) state.nextTaskKind = TASK_FOR_FAILURE[grade.failureType];
    else if (access >= 2 && grade.fidelity >= 2 && (effectivePolicy(unit) === 'reconstruir' || effectivePolicy(unit) === 'ejecutar') && (lastAppliedUse === null || lastAppliedUse === 0)) state.nextTaskKind = 'aplicada';
    else state.nextTaskKind = defaultKind;

    state.mode = usedInContexts.size >= 2 && state.step >= 2 ? 'mantenimiento' : 'cola';
    if (state.mode === 'mantenimiento') state.dueDate = addDays(day, MAINTENANCE_DAYS);
    if (state.mode === 'mantenimiento') entry(true, 'mantenimiento', MAINTENANCE_DAYS);
    else if (disputed) entry(true, 'verificar', RELEARN_DAYS);
    else if (access <= 1) entry(true, 'reaprender', RELEARN_DAYS);
    else entry(true, success ? 'intervalo' : 'repetir', intervalDays(state.step));
  }

  if (state.dueDate === null) state.dueDate = localDate(now, timeZone);
  state.brier = state.eligibleCount > 0 ? brierSum / state.eligibleCount : null;
  return state;
}

/** Due units for today, alternating the oldest and the newest so each session mixes old and recent material. */
export function dailyQueue(regulations: readonly UnitRegulation[], today: string, cap = 5): UnitRegulation[] {
  const due = regulations
    .filter(r => r.mode !== 'fuera' && r.dueDate !== null && r.dueDate <= today)
    .sort((a, b) => a.since.localeCompare(b.since) || a.unitId.localeCompare(b.unitId));
  const mixed: UnitRegulation[] = [];
  for (let low = 0, high = due.length - 1; low <= high && mixed.length < cap;) {
    mixed.push(due[low++]!);
    if (low <= high && mixed.length < cap) mixed.push(due[high--]!);
  }
  return mixed;
}
