import { StudyError } from '../study/types.ts';
import { answerHash, LIMITS } from './schema.ts';
import { CUE_COUNT, SOURCE_OPENED, type AttemptStatus, type ModelJudgment, type PracticeAttempt, type PracticeTask, type SelfGrade } from './types.ts';

function ensure(attempt: PracticeAttempt, allowed: AttemptStatus[], action: string): void {
  if (!allowed.includes(attempt.status)) throw new StudyError('INVALID_TRANSITION', `Cannot ${action}: the attempt is ${attempt.status}`);
}

const next = (attempt: PracticeAttempt, change: Partial<PracticeAttempt>): PracticeAttempt =>
  ({ ...attempt, ...change, revision: attempt.revision + 1 });

/** Reveals one more cue; the level reached is the measured access, so it is never lowered. */
export function revealCue(attempt: PracticeAttempt): PracticeAttempt {
  ensure(attempt, ['open'], 'reveal a cue');
  if (attempt.cueLevel >= CUE_COUNT) throw new StudyError('INVALID_TRANSITION', 'All cues are already revealed');
  return next(attempt, { cueLevel: attempt.cueLevel + 1 });
}

/** Opening the source while answering ends retrieval: the attempt counts as not recalled. */
export function openSource(attempt: PracticeAttempt): PracticeAttempt {
  ensure(attempt, ['open'], 'open the source during the attempt');
  return next(attempt, { cueLevel: SOURCE_OPENED });
}

export function saveAnswer(attempt: PracticeAttempt, answer: string): PracticeAttempt {
  ensure(attempt, ['open'], 'change the answer');
  if (typeof answer !== 'string' || answer.length > LIMITS.answer) throw new StudyError('INVALID_INPUT', `The answer must be text of at most ${LIMITS.answer} characters`);
  return next(attempt, { answer });
}

export function freeze(attempt: PracticeAttempt, now: string): PracticeAttempt {
  ensure(attempt, ['open'], 'freeze');
  return next(attempt, { status: 'frozen', frozenAt: now, answerHash: answerHash(attempt.answer), cueLevelAtFreeze: attempt.cueLevel });
}

export function addJudgment(attempt: PracticeAttempt, judgment: ModelJudgment): PracticeAttempt {
  ensure(attempt, ['frozen', 'graded'], 'record a model judgment');
  return next(attempt, { judgments: [...attempt.judgments, judgment] });
}

/** The first grade is the original; later ones are appended as corrections. */
export function grade(attempt: PracticeAttempt, input: Omit<SelfGrade, 'gradedAt' | 'correction'>, now: string): PracticeAttempt {
  ensure(attempt, ['frozen', 'graded'], 'grade');
  const applied = attempt.taskKind === 'aplicada';
  if (applied && input.use === null) throw new StudyError('INVALID_INPUT', 'An applied case needs a use rating');
  if (!applied && input.use !== null) throw new StudyError('INVALID_INPUT', 'Only applied cases take a use rating');
  const entry: SelfGrade = { ...input, gradedAt: now, correction: attempt.grades.length > 0 };
  return next(attempt, { status: 'graded', grades: [...attempt.grades, entry] });
}

/** Only an attempt still being answered can be dropped; once frozen it must be graded, so a seen failure is never discarded. */
export function abandon(attempt: PracticeAttempt): PracticeAttempt {
  ensure(attempt, ['open'], 'abandon');
  return next(attempt, { status: 'abandoned' });
}

export interface PublicAttempt {
  attempt: PracticeAttempt;
  prompt: string;
  /** Cues revealed so far; all five once frozen. */
  cues: string[];
  reference: string | null;
  rubric: string[] | null;
}

/** What may leave the backend: before freezing, only the prompt and the cues already asked for. */
export function publicAttempt(attempt: PracticeAttempt, task: PracticeTask): PublicAttempt {
  if (attempt.taskId !== task.id) throw new StudyError('CORRUPT_DATA', `Attempt ${attempt.id} does not belong to task ${task.id}`);
  const revealed = attempt.status === 'frozen' || attempt.status === 'graded';
  return {
    attempt: structuredClone(attempt),
    prompt: task.prompt,
    cues: revealed ? [...task.cues] : task.cues.slice(0, Math.min(attempt.cueLevel, CUE_COUNT)),
    reference: revealed ? task.reference : null,
    rubric: revealed ? [...task.rubric] : null,
  };
}
