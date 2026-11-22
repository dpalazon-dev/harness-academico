import type { AttemptAggregate, CheckRecord, CheckRevision, CheckType, GradeEvent, HelpLevel, ReviewState } from './types.ts';

export interface PublicCheckRevision {
  revision: number;
  title: string;
  objective: string;
  type: CheckType;
  prompt: string;
  reviewed: boolean;
  createdAt: string;
  activatedAt: string | null;
  reviewPolicyVersion: 1;
}

export interface PublicCheck {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  activeRevision: number | null;
  latest: PublicCheckRevision;
  review: ReviewState | null;
}

export interface PublicAttempt {
  id: string;
  revision: number;
  checkId: string;
  checkRevision: number;
  episodeId: string;
  timeZone: string;
  openedAt: string;
  frozenAt: string | null;
  status: AttemptAggregate['status'];
  confidence: number;
  help: HelpLevel;
  lastExposedAt: string | null;
  question: PublicCheckRevision;
  answer: string;
  answerHash: string | null;
  grades: GradeEvent[];
}

export function publicRevision(value: CheckRevision): PublicCheckRevision {
  return { revision: value.revision, title: value.title, objective: value.objective,
    type: value.type, prompt: value.prompt, reviewed: value.reviewed, createdAt: value.createdAt,
    activatedAt: value.activatedAt, reviewPolicyVersion: value.reviewPolicyVersion };
}

export function publicCheck(value: CheckRecord, latest: CheckRevision, review: ReviewState | null): PublicCheck {
  return { id: value.id, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    archived: value.archived, activeRevision: value.activeRevision, latest: publicRevision(latest),
    review: review === null ? null : { checkId: review.checkId, checkRevision: review.checkRevision, state: review.state,
      step: review.step, dueDate: review.dueDate, eligibleAt: review.eligibleAt, needsVerification: review.needsVerification,
      eligibleCount: review.eligibleCount, lastConfidence: review.lastConfidence } };
}

export function publicAttempt(value: AttemptAggregate): PublicAttempt {
  return { id: value.id, revision: value.revision, checkId: value.checkId, checkRevision: value.checkRevision,
    episodeId: value.episodeId, timeZone: value.timeZone, openedAt: value.openedAt, frozenAt: value.frozenAt,
    status: value.status, confidence: value.confidence, help: value.help, lastExposedAt: value.lastExposedAt,
    question: publicRevision(value.snapshot), answer: value.answer, answerHash: value.answerHash,
    grades: value.grades.map(grade => ({ score: grade.score, marks: [...grade.marks], diagnosis: grade.diagnosis,
      gradedAt: grade.gradedAt, evaluator: grade.evaluator, correction: grade.correction })) };
}
