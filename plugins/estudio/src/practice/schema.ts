import { createHash } from 'node:crypto';
import { fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';
import {
  CUE_COUNT, FAILURE_TYPES, SOURCE_OPENED, TASK_KINDS,
  type FailureType, type Fidelity, type ModelJudgment, type ModelRef, type PracticeAttempt, type PracticeTask,
  type SelfGrade, type TaskKind, type UnitExposures, type Use,
} from './types.ts';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
/** Only the most recent exposures matter for eligibility; older ones are dropped when the log is full. */
export const MAX_EXPOSURES = 1000;
export const LIMITS = { prompt: 4000, cue: 2000, reference: 20000, rubricItem: 1000, answer: 20000, rationale: 4000, context: 200 } as const;

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

function instant(value: unknown, path: string): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) invalid(`${path} must be an ISO instant`);
  return value;
}

function nullableInstant(value: unknown, path: string): string | null {
  return value === null ? null : instant(value, path);
}

function integer(value: unknown, min: number, max: number, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${path} must be an integer in [${min}, ${max}]`);
  return value as number;
}

function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${path} has an unsupported value`);
  return value as T;
}

function textList(value: unknown, min: number, max: number, itemMax: number, path: string): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${path} must have between ${min} and ${max} items`);
  return value.map((item, i) => text(item, itemMax, `${path}[${i}]`, { required: true }));
}

export const fidelity = (v: unknown, path: string): Fidelity => integer(v, 0, 3, path) as Fidelity;
export const use = (v: unknown, path: string): Use => integer(v, 0, 2, path) as Use;
export const failureType = (v: unknown, path: string): FailureType | null => v === null ? null : member(v, FAILURE_TYPES, path);
export const taskKind = (v: unknown, path: string): TaskKind => member(v, TASK_KINDS, path);

function model(value: unknown, path: string): ModelRef {
  const r = fields(value, ['provider', 'id'], path);
  return { provider: text(r.provider, 200, `${path}.provider`, { required: true }), id: text(r.id, 200, `${path}.id`, { required: true }) };
}

export function answerHash(answer: string): string {
  return createHash('sha256').update(answer, 'utf8').digest('hex');
}

export function parseTask(value: unknown): PracticeTask {
  const r = fields(value, ['id', 'revision', 'unitId', 'kind', 'prompt', 'cues', 'reference', 'rubric', 'createdAt', 'model'], 'task');
  return {
    id: id(r.id, 'task.id'),
    revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER, 'task.revision'),
    unitId: id(r.unitId, 'task.unitId'),
    kind: taskKind(r.kind, 'task.kind'),
    prompt: text(r.prompt, LIMITS.prompt, 'task.prompt', { required: true }),
    cues: textList(r.cues, CUE_COUNT, CUE_COUNT, LIMITS.cue, 'task.cues'),
    reference: text(r.reference, LIMITS.reference, 'task.reference', { required: true }),
    rubric: textList(r.rubric, 1, 20, LIMITS.rubricItem, 'task.rubric'),
    createdAt: instant(r.createdAt, 'task.createdAt'),
    model: model(r.model, 'task.model'),
  };
}

export function parseJudgment(value: unknown, path: string): ModelJudgment {
  const r = fields(value, ['fidelity', 'failureType', 'rationale', 'judgedAt', 'model'], path);
  return {
    fidelity: fidelity(r.fidelity, `${path}.fidelity`),
    failureType: failureType(r.failureType, `${path}.failureType`),
    rationale: text(r.rationale, LIMITS.rationale, `${path}.rationale`),
    judgedAt: instant(r.judgedAt, `${path}.judgedAt`),
    model: model(r.model, `${path}.model`),
  };
}

function parseGrade(value: unknown, path: string): SelfGrade {
  const r = fields(value, ['fidelity', 'use', 'failureType', 'gradedAt', 'correction'], path);
  if (typeof r.correction !== 'boolean') invalid(`${path}.correction must be a boolean`);
  return {
    fidelity: fidelity(r.fidelity, `${path}.fidelity`),
    use: r.use === null ? null : use(r.use, `${path}.use`),
    failureType: failureType(r.failureType, `${path}.failureType`),
    gradedAt: instant(r.gradedAt, `${path}.gradedAt`),
    correction: r.correction,
  };
}

const ATTEMPT_KEYS = ['id', 'revision', 'unitId', 'taskId', 'taskKind', 'openedAt', 'confidence', 'cueLevel', 'cueLevelAtFreeze',
  'answer', 'answerHash', 'frozenAt', 'status', 'contextLabel', 'judgments', 'grades'] as const;

export function parseAttempt(value: unknown): PracticeAttempt {
  const r = fields(value, ATTEMPT_KEYS, 'attempt');
  if (!Array.isArray(r.judgments) || !Array.isArray(r.grades)) invalid('attempt.judgments and attempt.grades must be lists');
  const attempt: PracticeAttempt = {
    id: id(r.id, 'attempt.id'),
    revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER, 'attempt.revision'),
    unitId: id(r.unitId, 'attempt.unitId'),
    taskId: id(r.taskId, 'attempt.taskId'),
    taskKind: taskKind(r.taskKind, 'attempt.taskKind'),
    openedAt: instant(r.openedAt, 'attempt.openedAt'),
    confidence: integer(r.confidence, 0, 100, 'attempt.confidence'),
    cueLevel: integer(r.cueLevel, 0, SOURCE_OPENED, 'attempt.cueLevel'),
    cueLevelAtFreeze: r.cueLevelAtFreeze === null ? null : integer(r.cueLevelAtFreeze, 0, SOURCE_OPENED, 'attempt.cueLevelAtFreeze'),
    answer: text(r.answer, LIMITS.answer, 'attempt.answer'),
    answerHash: r.answerHash === null ? null : text(r.answerHash, 64, 'attempt.answerHash', { required: true }),
    frozenAt: nullableInstant(r.frozenAt, 'attempt.frozenAt'),
    status: member(r.status, ['open', 'frozen', 'graded', 'abandoned'] as const, 'attempt.status'),
    contextLabel: text(r.contextLabel, LIMITS.context, 'attempt.contextLabel'),
    judgments: r.judgments.map((j, i) => parseJudgment(j, `attempt.judgments[${i}]`)),
    grades: r.grades.map((g, i) => parseGrade(g, `attempt.grades[${i}]`)),
  };
  const frozen = attempt.status === 'frozen' || attempt.status === 'graded';
  if (frozen !== (attempt.frozenAt !== null) && attempt.status !== 'abandoned') invalid('attempt.frozenAt does not match its status');
  if (attempt.frozenAt !== null && (attempt.answerHash === null || attempt.cueLevelAtFreeze === null)) invalid('a frozen attempt needs its answer hash and cue level');
  if (attempt.answerHash !== null && attempt.answerHash !== answerHash(attempt.answer)) {
    throw new StudyError('CORRUPT_DATA', `attempt ${attempt.id}: the frozen answer does not match its hash`);
  }
  if ((attempt.status === 'graded') !== (attempt.grades.length > 0)) invalid('attempt.grades does not match its status');
  return attempt;
}

export function parseExposures(value: unknown): UnitExposures {
  const r = fields(value, ['id', 'revision', 'instants'], 'exposures');
  if (!Array.isArray(r.instants) || r.instants.length > MAX_EXPOSURES) invalid(`exposures.instants must be a list of at most ${MAX_EXPOSURES} instants`);
  return {
    id: id(r.id, 'exposures.id'),
    revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER, 'exposures.revision'),
    instants: r.instants.map((v, i) => instant(v, `exposures.instants[${i}]`)),
  };
}
