export type CheckType = 'explain' | 'code' | 'derive' | 'judge' | 'numeric';
export type Score = 'cant' | 'partial' | 'fluent';
export type RubricMark = 'met' | 'partial' | 'missing';
export type HelpLevel = 'none' | 'hint' | 'partial_solution' | 'solution' | 'unknown';
export type AssessmentErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'INVALID_TRANSITION' | 'CONFLICT' | 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'STORE_LOCKED' | 'CORRUPT_DATA';

export class AssessmentError extends Error {
  code: AssessmentErrorCode;
  constructor(code: AssessmentErrorCode, message: string) {
    super(message);
    this.name = 'AssessmentError';
    this.code = code;
  }
}

export interface CheckRevision {
  revision: number;
  title: string;
  objective: string;
  type: CheckType;
  prompt: string;
  reference: string;
  rubric: string[];
  reviewed: boolean;
  createdAt: string;
  activatedAt: string | null;
  reviewPolicyVersion: 1;
}

export interface CheckRecord {
  id: string;
  formatVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  activeRevision: number | null;
  revisions: CheckRevision[];
  lastExposedAt: string | null;
}

export interface GradeEvent {
  score: Score;
  marks: RubricMark[];
  diagnosis: string;
  gradedAt: string;
  evaluator: 'self';
  correction: boolean;
}

export interface AttemptAggregate {
  id: string;
  formatVersion: 1;
  revision: number;
  checkId: string;
  checkRevision: number;
  reviewPolicyVersion: 1;
  episodeId: string;
  timeZone: string;
  openedAt: string;
  frozenAt: string | null;
  status: 'open' | 'frozen' | 'graded' | 'abandoned';
  confidence: number;
  help: HelpLevel;
  lastExposedAt: string | null;
  snapshot: CheckRevision;
  answer: string;
  answerHash: string | null;
  grades: GradeEvent[];
}

export type AttemptCommand =
  | { type: 'saveAnswer'; answer: string }
  | { type: 'freeze' }
  | { type: 'grade'; score: Score; marks: RubricMark[]; diagnosis: string }
  | { type: 'correctGrade'; score: Score; marks: RubricMark[]; diagnosis: string }
  | { type: 'abandon' };

export interface ReviewState {
  checkId: string;
  checkRevision: number;
  state: 'not_started' | 'attempted' | 'familiar' | 'proficient' | 'durable';
  step: number;
  dueDate: string | null;
  eligibleAt: string | null;
  needsVerification: boolean;
  eligibleCount: number;
  lastConfidence: number | null;
}
