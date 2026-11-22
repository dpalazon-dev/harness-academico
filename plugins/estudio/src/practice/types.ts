export type TaskKind = 'guiada' | 'libre' | 'estructural' | 'aplicada' | 'comparacion' | 'transferencia';
export type FailureType = 'acceso' | 'precision' | 'estructural' | 'discriminacion' | 'aplicacion' | 'transferencia';
export type Fidelity = 0 | 1 | 2 | 3;
export type Use = 0 | 1 | 2;

export const TASK_KINDS: readonly TaskKind[] = ['guiada', 'libre', 'estructural', 'aplicada', 'comparacion', 'transferencia'];
export const FAILURE_TYPES: readonly FailureType[] = ['acceso', 'precision', 'estructural', 'discriminacion', 'aplicacion', 'transferencia'];

/** Cue ladder: 0 none, 1 general question, 2 structure, 3 semantic cue, 4 partial information, 5 recognition. 6 = source opened. */
export const CUE_COUNT = 5;
export const SOURCE_OPENED = 6;

export interface ModelRef { provider: string; id: string }

/** A retrieval task generated for one unit. Reference, rubric and unrevealed cues stay in the backend until freeze. */
export interface PracticeTask {
  id: string;
  revision: number;
  unitId: string;
  kind: TaskKind;
  prompt: string;
  cues: string[];
  reference: string;
  rubric: string[];
  createdAt: string;
  model: ModelRef;
}

export interface ModelJudgment {
  fidelity: Fidelity;
  failureType: FailureType | null;
  rationale: string;
  judgedAt: string;
  model: ModelRef;
}

/** David's own judgment after the contrast; later ones are corrections, never replacements. */
export interface SelfGrade {
  fidelity: Fidelity;
  use: Use | null;
  failureType: FailureType | null;
  gradedAt: string;
  correction: boolean;
}

export type AttemptStatus = 'open' | 'frozen' | 'graded' | 'abandoned';

export interface PracticeAttempt {
  id: string;
  revision: number;
  unitId: string;
  taskId: string;
  taskKind: TaskKind;
  openedAt: string;
  confidence: number;
  cueLevel: number;
  cueLevelAtFreeze: number | null;
  answer: string;
  answerHash: string | null;
  frozenAt: string | null;
  status: AttemptStatus;
  contextLabel: string;
  judgments: ModelJudgment[];
  grades: SelfGrade[];
}

/** Moments when a unit's reference content was shown: contrast, opened source, native session turns. */
export interface UnitExposures {
  id: string;
  revision: number;
  instants: string[];
}
