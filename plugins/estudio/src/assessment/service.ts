import { createHash } from 'node:crypto';
import { AssessmentError } from './types.ts';
import type { AttemptAggregate, AttemptCommand, CheckRecord, CheckRevision, CheckType, HelpLevel, ReviewState } from './types.ts';
import { isNamedTimeZone, parseAttempt, parseAttemptCommand, parseCheck, validateId, validateInstant } from './schema.ts';
import { transitionAttempt } from './transitions.ts';
import { activeReviewedRevision, deriveReview } from './policy.ts';
import { localDate } from './calendar.ts';
import { buildQueue } from './queue.ts';
import type { AssessmentFileStore } from './store.ts';
import { publicAttempt, publicCheck } from './projections.ts';
import type { PublicAttempt, PublicCheck } from './projections.ts';

export interface CheckContent {
  title: string;
  objective: string;
  type: CheckType;
  prompt: string;
  reference: string;
  rubric: string[];
}
export interface CreateCheckRequest { id: string; operationId: string; expectedRevision: null; content: CheckContent }
export interface CheckMutationRequest { id: string; operationId: string; expectedRevision: number }
export interface ReviseCheckRequest extends CheckMutationRequest { content: CheckContent }
export interface OpenAttemptRequest {
  id: string;
  operationId: string;
  expectedRevision: null;
  checkId: string;
  checkExpectedRevision: number;
  episodeId: string;
  confidence: number;
  help: HelpLevel;
}
export interface CommandAttemptRequest { id: string; operationId: string; expectedRevision: number; command: AttemptCommand }
export interface AssessmentServiceOptions { now: () => string; id: () => string; timeZone: string }
export interface EditorCheck { check: PublicCheck; content: CheckContent }
export interface RevealedAttempt { attempt: PublicAttempt; reference: string; rubric: string[] }
export interface AssessmentService {
  createCheck(request: CreateCheckRequest): Promise<PublicCheck>;
  activateCheck(request: CheckMutationRequest): Promise<PublicCheck>;
  reviseCheck(request: ReviseCheckRequest): Promise<PublicCheck>;
  archiveCheck(request: CheckMutationRequest): Promise<PublicCheck>;
  openAttempt(request: OpenAttemptRequest): Promise<PublicAttempt>;
  commandAttempt(request: CommandAttemptRequest): Promise<PublicAttempt>;
  getCheck(id: string): Promise<PublicCheck>;
  listChecks(): Promise<PublicCheck[]>;
  getAttempt(id: string): Promise<PublicAttempt>;
  history(checkId: string): Promise<PublicAttempt[]>;
  queue(): Promise<ReviewState[]>;
  revealAttempt(id: string): Promise<RevealedAttempt>;
  editCheck(id: string): Promise<EditorCheck>;
}

export type AssessmentServiceFactory = (store: AssessmentFileStore, options: AssessmentServiceOptions) => AssessmentService;

function fail(code: 'INVALID_INPUT' | 'INVALID_TRANSITION' | 'NOT_FOUND' | 'CONFLICT', message: string): never {
  throw new AssessmentError(code, message);
}

function fields(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Expected a plain request object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('INVALID_INPUT', 'Expected a plain request object');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) fail('INVALID_INPUT', 'Request fields do not match the contract');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !expected.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      fail('INVALID_INPUT', 'Request fields do not match the contract');
    }
  }
  return value as Record<string, unknown>;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('INVALID_INPUT', 'Expected a positive record revision');
  return value;
}

function latest(check: CheckRecord): CheckRevision {
  const result = check.revisions.reduce<CheckRevision | null>((found, item) => found === null || item.revision > found.revision ? item : found, null);
  if (result === null) return fail('INVALID_INPUT', 'Check has no content revision');
  return result;
}

function parseContent(value: unknown): CheckContent {
  const row = fields(value, ['title', 'objective', 'type', 'prompt', 'reference', 'rubric']);
  // Reuse the full schema for text, Unicode, rubric, enum and size validation.
  const at = '2000-01-01T00:00:00.000Z';
  const parsed = parseCheck({ id: 'validation', formatVersion: 1, revision: 1, createdAt: at, updatedAt: at,
    archived: false, activeRevision: null, lastExposedAt: at,
    revisions: [{ revision: 1, title: row.title, objective: row.objective, type: row.type, prompt: row.prompt,
      reference: row.reference, rubric: row.rubric, reviewed: false, createdAt: at, activatedAt: null, reviewPolicyVersion: 1 }] });
  return contentOf(latest(parsed));
}

function contentOf(value: CheckRevision): CheckContent {
  return { title: value.title, objective: value.objective, type: value.type, prompt: value.prompt,
    reference: value.reference, rubric: [...value.rubric] };
}

function mutation(value: unknown, extra: readonly string[] = [], create = false) {
  const row = fields(value, ['id', 'operationId', 'expectedRevision', ...extra]);
  if (create && row.expectedRevision !== null) fail('INVALID_INPUT', 'Creation requires a null expected revision');
  return { row, id: validateId(row.id), operationId: validateId(row.operationId, 'operationId'),
    expectedRevision: create ? null : revision(row.expectedRevision) };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

function hash(method: string, request: object): string {
  return createHash('sha256').update(canonical({ method, request }), 'utf8').digest('hex');
}

export function createAssessmentService(store: AssessmentFileStore, options: AssessmentServiceOptions): AssessmentService {
  const config = fields(options, ['now', 'id', 'timeZone']);
  if (typeof config.now !== 'function' || typeof config.id !== 'function' || !isNamedTimeZone(config.timeZone)) {
    fail('INVALID_INPUT', 'Assessment service requires clocks, IDs and a valid IANA timezone');
  }
  const now = config.now as () => string;
  const newId = config.id as () => string;
  const timeZone = config.timeZone as string;
  let tail: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: (at: string) => Promise<T>): Promise<T> {
    const result = tail.then(() => operation(validateInstant(now(), 'now')));
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  // Preparation executes synchronously; its detached result is captured before
  // entering the queue, while validation failures retain the async method API.
  function prepare<I, O>(parse: () => I, operation: (input: I, at: string) => Promise<O>): Promise<O> {
    try { const input = parse(); return enqueue(at => operation(input, at)); }
    catch (error) { return Promise.reject(error); }
  }
  async function readCheck(id: string): Promise<CheckRecord> {
    const row = await store.read<CheckRecord>('checks', id);
    if (row === null) fail('NOT_FOUND', 'Check does not exist');
    return parseCheck(row);
  }
  async function readAttempt(id: string): Promise<AttemptAggregate> {
    const row = await store.read<AttemptAggregate>('attempts', id);
    if (row === null) fail('NOT_FOUND', 'Attempt does not exist');
    return parseAttempt(row);
  }
  async function attempts(): Promise<AttemptAggregate[]> {
    return (await store.list<AttemptAggregate>('attempts')).map(parseAttempt);
  }
  async function hasOpenAttempt(checkId: string): Promise<boolean> {
    return (await attempts()).some(attempt => attempt.checkId === checkId && attempt.status === 'open');
  }
  async function project(check: CheckRecord, at: string): Promise<PublicCheck> {
    return publicCheck(check, latest(check), deriveReview(check, await attempts(), at, timeZone));
  }
  async function exposure(id: string, at: string): Promise<CheckRecord> {
    const check = await readCheck(id);
    if (await hasOpenAttempt(id)) fail('INVALID_TRANSITION', 'Freeze or abandon all open attempts before viewing a reference');
    const operationId = validateId(newId(), 'internal operationId');
    const request = { id, expectedRevision: check.revision };
    const result = await store.commit<CheckRecord>('checks', id,
      { operationId, expectedRevision: check.revision, requestHash: hash('exposure', request) }, current => {
        if (current === null) return fail('NOT_FOUND', 'Check does not exist');
        const next = parseCheck(current);
        if (at < next.updatedAt) fail('INVALID_INPUT', 'now precedes the latest check event');
        next.revision++; next.updatedAt = at; next.lastExposedAt = at;
        return parseCheck(next);
      });
    return parseCheck(result);
  }
  async function checkChange(method: 'activateCheck' | 'reviseCheck' | 'archiveCheck', input: CheckMutationRequest & { content?: CheckContent }, at: string) {
    let revisionGuard: { open: boolean } | { error: unknown } = { open: false };
    if (method === 'reviseCheck') {
      try { revisionGuard = { open: await hasOpenAttempt(input.id) }; }
      catch (error) { revisionGuard = { error }; }
    }
    const result = await store.commit<CheckRecord>('checks', input.id,
      { operationId: input.operationId, expectedRevision: input.expectedRevision, requestHash: hash(method, input) }, current => {
        if (current === null) return fail('NOT_FOUND', 'Check does not exist');
        const next = parseCheck(current);
        if (at < next.updatedAt) fail('INVALID_INPUT', 'now precedes the latest check event');
        if (next.archived) fail('INVALID_TRANSITION', 'Archived checks cannot be changed');
        const newest = latest(next);
        if (method === 'activateCheck') {
          if (newest.reviewed || newest.activatedAt !== null) fail('INVALID_TRANSITION', 'Latest revision is already active');
          newest.reviewed = true; newest.activatedAt = at; next.activeRevision = newest.revision;
        } else if (method === 'reviseCheck') {
          // The store checks receipts before invoking this synchronous transform.
          // A later opening must not invalidate a previously committed retry.
          if ('error' in revisionGuard) throw revisionGuard.error;
          if (revisionGuard.open) fail('INVALID_TRANSITION', 'Freeze or abandon all open attempts before authoring a revision');
          if (!input.content) return fail('INVALID_INPUT', 'Revision content is required');
          next.revisions.push({ revision: newest.revision + 1, ...input.content, rubric: [...input.content.rubric],
            reviewed: false, createdAt: at, activatedAt: null, reviewPolicyVersion: 1 });
          next.lastExposedAt = at;
        } else next.archived = true;
        next.revision++; next.updatedAt = at;
        return parseCheck(next);
      });
    return project(parseCheck(result), at);
  }

  return {
    createCheck(request) {
      return prepare(() => {
        const input = mutation(request, ['content'], true);
        return { id: input.id, operationId: input.operationId, expectedRevision: null, content: parseContent(input.row.content) } satisfies CreateCheckRequest;
      }, async (input, at) => {
        const check = await store.commit<CheckRecord>('checks', input.id,
          { operationId: input.operationId, expectedRevision: null, requestHash: hash('createCheck', input) }, () => parseCheck({
            id: input.id, formatVersion: 1, revision: 1, createdAt: at, updatedAt: at, archived: false,
            activeRevision: null, lastExposedAt: at,
            revisions: [{ revision: 1, ...input.content, reviewed: false, createdAt: at, activatedAt: null, reviewPolicyVersion: 1 }],
          }));
        return project(parseCheck(check), at);
      });
    },
    activateCheck(request) {
      return prepare(() => { const { id, operationId, expectedRevision } = mutation(request); return { id, operationId, expectedRevision: revision(expectedRevision) }; },
        (input, at) => checkChange('activateCheck', input, at));
    },
    reviseCheck(request) {
      return prepare(() => { const input = mutation(request, ['content']); return { id: input.id, operationId: input.operationId,
        expectedRevision: revision(input.expectedRevision), content: parseContent(input.row.content) }; },
      (input, at) => checkChange('reviseCheck', input, at));
    },
    archiveCheck(request) {
      return prepare(() => { const { id, operationId, expectedRevision } = mutation(request); return { id, operationId, expectedRevision: revision(expectedRevision) }; },
        (input, at) => checkChange('archiveCheck', input, at));
    },
    openAttempt(request) {
      return prepare(() => {
        const input = mutation(request, ['checkId', 'checkExpectedRevision', 'episodeId', 'confidence', 'help'], true);
        const checkId = validateId(input.row.checkId, 'checkId');
        const checkExpectedRevision = revision(input.row.checkExpectedRevision);
        const episodeId = validateId(input.row.episodeId, 'episodeId');
        // Validate confidence/help using the shared complete aggregate schema.
        const at = '2000-01-01T00:00:00.000Z';
        const checked = parseAttempt({ id: input.id, formatVersion: 1, revision: 1, checkId, checkRevision: 1,
          reviewPolicyVersion: 1, episodeId, timeZone, openedAt: at, frozenAt: null, status: 'open', confidence: input.row.confidence,
          help: input.row.help, lastExposedAt: null, snapshot: { revision: 1, title: 'validation', objective: 'validation', type: 'explain',
            prompt: 'validation', reference: '', rubric: ['validation'], reviewed: false, createdAt: at, activatedAt: null, reviewPolicyVersion: 1 },
          answer: '', answerHash: null, grades: [] });
        return { id: input.id, operationId: input.operationId, expectedRevision: null, checkId, checkExpectedRevision,
          episodeId, confidence: checked.confidence, help: checked.help } satisfies OpenAttemptRequest;
      }, async (input, at) => {
        const options = { operationId: input.operationId, expectedRevision: null, requestHash: hash('openAttempt', input) };
        const existing = await store.read<AttemptAggregate>('attempts', input.id);
        if (existing !== null) {
          parseAttempt(existing);
          // Receipt lookup happens before OCC in the store; no check read can
          // invalidate a committed retry after later check edits or archival.
          const replay = await store.commit<AttemptAggregate>('attempts', input.id, options, () => fail('CONFLICT', 'Attempt already exists'));
          return publicAttempt(parseAttempt(replay));
        }
        const check = await readCheck(input.checkId);
        if (check.revision !== input.checkExpectedRevision) fail('CONFLICT', 'Check record revision changed');
        const snapshot = activeReviewedRevision(check);
        if (snapshot === null) fail('INVALID_TRANSITION', 'Check has no active reviewed revision');
        const attempt = parseAttempt({ id: input.id, formatVersion: 1, revision: 1, checkId: input.checkId,
          checkRevision: snapshot.revision, reviewPolicyVersion: 1, episodeId: input.episodeId, timeZone,
          openedAt: at, frozenAt: null, status: 'open', confidence: input.confidence, help: input.help,
          lastExposedAt: check.lastExposedAt, snapshot, answer: '', answerHash: null, grades: [] });
        return publicAttempt(parseAttempt(await store.commit<AttemptAggregate>('attempts', input.id, options, () => attempt)));
      });
    },
    commandAttempt(request) {
      return prepare(() => {
        const input = mutation(request, ['command']);
        return { id: input.id, operationId: input.operationId, expectedRevision: revision(input.expectedRevision), command: parseAttemptCommand(input.row.command) };
      }, async (input, at) => publicAttempt(parseAttempt(await store.commit<AttemptAggregate>('attempts', input.id,
        { operationId: input.operationId, expectedRevision: input.expectedRevision, requestHash: hash('commandAttempt', input) }, current => {
          if (current === null) return fail('NOT_FOUND', 'Attempt does not exist');
          return transitionAttempt(parseAttempt(current), input.command, at);
        }))));
    },
    getCheck(id) { return prepare(() => validateId(id), async (value, at) => project(await readCheck(value), at)); },
    listChecks() { return enqueue(async at => {
      const checks = (await store.list<CheckRecord>('checks')).map(parseCheck);
      const history = await attempts();
      return checks.map(check => publicCheck(check, latest(check), deriveReview(check, history, at, timeZone)));
    }); },
    getAttempt(id) { return prepare(() => validateId(id), async value => publicAttempt(await readAttempt(value))); },
    history(checkId) { return prepare(() => validateId(checkId), async id => {
      await readCheck(id);
      return (await attempts()).filter(attempt => attempt.checkId === id)
        .sort((a, b) => a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(publicAttempt);
    }); },
    queue() { return enqueue(async at => {
      const checks = (await store.list<CheckRecord>('checks')).map(parseCheck);
      const history = await attempts();
      const states = checks.map(check => deriveReview(check, history, at, timeZone)).filter((state): state is ReviewState => state !== null);
      return buildQueue(states, localDate(at, timeZone));
    }); },
    revealAttempt(id) { return prepare(() => validateId(id), async (value, at) => {
      const attempt = await readAttempt(value);
      if (attempt.status !== 'frozen' && attempt.status !== 'graded') fail('INVALID_TRANSITION', 'Reveal requires a frozen or graded attempt');
      await exposure(attempt.checkId, at);
      return { attempt: publicAttempt(attempt), reference: attempt.snapshot.reference, rubric: [...attempt.snapshot.rubric] };
    }); },
    editCheck(id) { return prepare(() => validateId(id), async (value, at) => {
      const check = await exposure(value, at);
      return { check: await project(check, at), content: contentOf(latest(check)) };
    }); },
  };
}
