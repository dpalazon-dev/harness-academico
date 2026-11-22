import { createHash } from 'node:crypto';
import { AssessmentError } from './types.ts';
import type { AttemptAggregate, AttemptCommand, CheckRecord, CheckRevision, GradeEvent, RubricMark, Score } from './types.ts';

function invalid(message: string): never {
  throw new AssessmentError('INVALID_INPUT', message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) invalid(`${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !('value' in descriptor) || !descriptor.enumerable) invalid(`${path} has an unsupported property`);
  }
  return value as Record<string, unknown>;
}

function fields(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  const result = object(value, path);
  const keys = Object.keys(result);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) invalid(`${path} fields do not match the contract`);
  return result;
}

function array(value: unknown, minimum: number, maximum: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(`${path} has an invalid length`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.every((key) => key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))) {
    invalid(`${path} must be a dense array without extra fields`);
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid(`${path} has an unsupported element`);
  }
  return value;
}

function text(value: unknown, maximum: number, path: string, nonblank = false): string {
  if (typeof value !== 'string' || value.length > maximum || (nonblank && value.trim().length === 0)) invalid(`${path} is invalid`);
  // Preserve exact text: UTF-8 encoding would silently replace isolated surrogates.
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) invalid(`${path} contains ill-formed UTF-16`);
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(`${path} contains ill-formed UTF-16`);
    }
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(`${path} must be a positive safe integer`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(`${path} must be boolean`);
  return value;
}

/** IANA zone names only: Intl also accepts offsets such as "+01:00", which attempts reject. */
export function isNamedTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${path} has an unsupported value`);
  return value as T;
}

function version(value: unknown, path: string): 1 {
  if (value !== 1) throw new AssessmentError('UNSUPPORTED_FORMAT', `${path} is unsupported`);
  return 1;
}

export function validateId(value: unknown, path = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) invalid(`${path} is invalid`);
  return value;
}

export function validateInstant(value: unknown, path = 'instant'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid(`${path} must be canonical UTC ISO`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) invalid(`${path} must be a valid UTC instant`);
  return value;
}

function nullableInstant(value: unknown, path: string): string | null {
  return value === null ? null : validateInstant(value, path);
}

function notBefore(value: string, minimum: string, path: string): void {
  if (value < minimum) invalid(`${path} is earlier than its preceding event`);
}

function parseRevision(value: unknown, path: string): CheckRevision {
  const record = fields(value, ['revision', 'title', 'objective', 'type', 'prompt', 'reference', 'rubric', 'reviewed', 'createdAt', 'activatedAt', 'reviewPolicyVersion'], path);
  const createdAt = validateInstant(record.createdAt, `${path}.createdAt`);
  const activatedAt = nullableInstant(record.activatedAt, `${path}.activatedAt`);
  const reviewed = boolean(record.reviewed, `${path}.reviewed`);
  if (activatedAt !== null) {
    if (!reviewed) invalid(`${path} cannot activate an unreviewed reference`);
    notBefore(activatedAt, createdAt, `${path}.activatedAt`);
  }
  return {
    revision: positiveInteger(record.revision, `${path}.revision`),
    title: text(record.title, 2000, `${path}.title`, true),
    objective: text(record.objective, 2000, `${path}.objective`, true),
    type: member(record.type, ['explain', 'code', 'derive', 'judge', 'numeric'], `${path}.type`),
    prompt: text(record.prompt, 20000, `${path}.prompt`, true),
    reference: text(record.reference, 100000, `${path}.reference`),
    rubric: array(record.rubric, 1, 100, `${path}.rubric`).map((criterion, index) => text(criterion, 2000, `${path}.rubric[${index}]`, true)),
    reviewed, createdAt, activatedAt,
    reviewPolicyVersion: version(record.reviewPolicyVersion, `${path}.reviewPolicyVersion`),
  };
}

export function parseCheck(value: unknown): CheckRecord {
  const record = fields(value, ['id', 'formatVersion', 'revision', 'createdAt', 'updatedAt', 'archived', 'activeRevision', 'revisions', 'lastExposedAt'], 'check');
  const createdAt = validateInstant(record.createdAt, 'check.createdAt');
  const updatedAt = validateInstant(record.updatedAt, 'check.updatedAt');
  notBefore(updatedAt, createdAt, 'check.updatedAt');
  const revisions = array(record.revisions, 1, Number.MAX_SAFE_INTEGER, 'check.revisions').map((revision, index) => parseRevision(revision, `check.revisions[${index}]`));
  const seen = new Set<number>();
  for (const revision of revisions) {
    if (seen.has(revision.revision)) invalid('check content revisions must be unique');
    seen.add(revision.revision);
    notBefore(revision.createdAt, createdAt, 'check revision.createdAt');
    notBefore(updatedAt, revision.createdAt, 'check.updatedAt');
    if (revision.activatedAt !== null) notBefore(updatedAt, revision.activatedAt, 'check.updatedAt');
  }
  const activeRevision = record.activeRevision === null ? null : positiveInteger(record.activeRevision, 'check.activeRevision');
  if (activeRevision !== null) {
    const active = revisions.find((revision) => revision.revision === activeRevision);
    if (!active || !active.reviewed || active.activatedAt === null) invalid('check active revision must be present, reviewed and activated');
  }
  const lastExposedAt = nullableInstant(record.lastExposedAt, 'check.lastExposedAt');
  if (lastExposedAt !== null) notBefore(updatedAt, lastExposedAt, 'check.updatedAt');
  return { id: validateId(record.id, 'check.id'), formatVersion: version(record.formatVersion, 'check.formatVersion'), revision: positiveInteger(record.revision, 'check.revision'), createdAt, updatedAt,
    archived: boolean(record.archived, 'check.archived'), activeRevision, revisions, lastExposedAt };
}

function parseGradeContent(record: Record<string, unknown>, path: string) {
  return {
    score: member<Score>(record.score, ['cant', 'partial', 'fluent'], `${path}.score`),
    marks: array(record.marks, 1, 100, `${path}.marks`).map((mark, index) => member<RubricMark>(mark, ['met', 'partial', 'missing'], `${path}.marks[${index}]`)),
    diagnosis: text(record.diagnosis, 4000, `${path}.diagnosis`),
  };
}

function parseGrade(value: unknown, path: string): GradeEvent {
  const record = fields(value, ['score', 'marks', 'diagnosis', 'gradedAt', 'evaluator', 'correction'], path);
  return { ...parseGradeContent(record, path), gradedAt: validateInstant(record.gradedAt, `${path}.gradedAt`),
    evaluator: member(record.evaluator, ['self'], `${path}.evaluator`), correction: boolean(record.correction, `${path}.correction`) };
}

export function parseAttempt(value: unknown): AttemptAggregate {
  const record = fields(value, ['id', 'formatVersion', 'revision', 'checkId', 'checkRevision', 'reviewPolicyVersion', 'episodeId', 'timeZone', 'openedAt', 'frozenAt', 'status', 'confidence', 'help', 'lastExposedAt', 'snapshot', 'answer', 'answerHash', 'grades'], 'attempt');
  const openedAt = validateInstant(record.openedAt, 'attempt.openedAt');
  const frozenAt = nullableInstant(record.frozenAt, 'attempt.frozenAt');
  const snapshot = parseRevision(record.snapshot, 'attempt.snapshot');
  const checkRevision = positiveInteger(record.checkRevision, 'attempt.checkRevision');
  if (checkRevision !== snapshot.revision) invalid('attempt check revision differs from its snapshot');
  notBefore(openedAt, snapshot.createdAt, 'attempt.openedAt');
  if (snapshot.activatedAt !== null) notBefore(openedAt, snapshot.activatedAt, 'attempt.openedAt');
  const confidence = record.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) invalid('attempt.confidence must be finite in [0,100]');
  const timeZone = text(record.timeZone, 100, 'attempt.timeZone', true);
  if (!isNamedTimeZone(timeZone)) invalid('attempt.timeZone must be a supported named timezone');
  const status = member(record.status, ['open', 'frozen', 'graded', 'abandoned'], 'attempt.status');
  const answer = text(record.answer, 100000, 'attempt.answer');
  let answerHash: string | null = null;
  if (record.answerHash !== null) {
    if (typeof record.answerHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.answerHash)) invalid('attempt.answerHash is invalid');
    answerHash = record.answerHash;
  }
  const grades = array(record.grades, 0, Number.MAX_SAFE_INTEGER, 'attempt.grades').map((grade, index) => parseGrade(grade, `attempt.grades[${index}]`));
  if ((frozenAt === null) !== (answerHash === null)) invalid('attempt freeze time and hash must appear together');
  if (frozenAt !== null) {
    notBefore(frozenAt, openedAt, 'attempt.frozenAt');
    if (answerHash !== createHash('sha256').update(answer, 'utf8').digest('hex')) invalid('attempt answer does not match its frozen hash');
  }
  if (status === 'open' && (frozenAt !== null || grades.length !== 0)) invalid('open attempt cannot contain freeze or grades');
  if ((status === 'frozen' || status === 'graded') && frozenAt === null) invalid('frozen or graded attempt must have frozen answer');
  if (status === 'graded' ? grades.length === 0 : grades.length !== 0) invalid('attempt grades disagree with status');
  let previousGradeAt = frozenAt;
  for (const [index, grade] of grades.entries()) {
    if (grade.marks.length !== snapshot.rubric.length) invalid('grade requires one mark per snapshot criterion');
    if (grade.correction !== (index > 0)) invalid('grades require one original followed by corrections');
    if (previousGradeAt === null) invalid('grade requires a frozen answer');
    notBefore(grade.gradedAt, previousGradeAt, 'grade.gradedAt');
    previousGradeAt = grade.gradedAt;
  }
  const lastExposedAt = nullableInstant(record.lastExposedAt, 'attempt.lastExposedAt');
  if (lastExposedAt !== null) notBefore(openedAt, lastExposedAt, 'attempt.openedAt');
  return { id: validateId(record.id, 'attempt.id'), formatVersion: version(record.formatVersion, 'attempt.formatVersion'), revision: positiveInteger(record.revision, 'attempt.revision'),
    checkId: validateId(record.checkId, 'attempt.checkId'), checkRevision, reviewPolicyVersion: version(record.reviewPolicyVersion, 'attempt.reviewPolicyVersion'), episodeId: validateId(record.episodeId, 'attempt.episodeId'),
    timeZone, openedAt, frozenAt, status, confidence, help: member(record.help, ['none', 'hint', 'partial_solution', 'solution', 'unknown'], 'attempt.help'), lastExposedAt, snapshot, answer, answerHash, grades };
}

export function parseAttemptCommand(value: unknown): AttemptCommand {
  const record = object(value, 'command');
  switch (record.type) {
    case 'saveAnswer': {
      fields(record, ['type', 'answer'], 'command');
      return { type: 'saveAnswer', answer: text(record.answer, 100000, 'command.answer') };
    }
    case 'freeze':
    case 'abandon':
      fields(record, ['type'], 'command');
      return { type: record.type };
    case 'grade':
    case 'correctGrade': {
      fields(record, ['type', 'score', 'marks', 'diagnosis'], 'command');
      const content = parseGradeContent(record, 'command');
      return record.type === 'grade' ? { type: 'grade', ...content } : { type: 'correctGrade', ...content };
    }
    default: return invalid('command.type is unsupported');
  }
}
