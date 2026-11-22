import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAssessmentService, type AssessmentService, type CheckContent, type CreateCheckRequest, type OpenAttemptRequest } from '../src/assessment/service.ts';
import { openAssessmentStore, type AssessmentFileStore } from '../src/assessment/store.ts';
import type { CheckRecord } from '../src/assessment/types.ts';

const REFERENCE = 'PRIVATE_REFERENCE_MARKER';
const RUBRIC = 'PRIVATE_RUBRIC_MARKER';
const initial = '2026-01-01T12:00:00.000Z';
const content = (): CheckContent => ({ title: 'Synthetic rule', objective: 'Explain the rule', type: 'explain', prompt: 'What is the rule?', reference: REFERENCE, rubric: [RUBRIC] });
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, expected); return true; };
function hidden(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes(REFERENCE));
  assert.ok(!serialized.includes(RUBRIC));
  const visit = (row: unknown): void => {
    if (!row || typeof row !== 'object') return;
    for (const [key, child] of Object.entries(row)) {
      assert.notEqual(key, 'reference'); assert.notEqual(key, 'rubric'); visit(child);
    }
  };
  visit(value);
}
async function fixture(t: { after(fn: () => Promise<void>): void }, wrap: (store: AssessmentFileStore) => AssessmentFileStore = store => store) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'assessment-service-'));
  const root = path.join(parent, 'data');
  const stores: AssessmentFileStore[] = [];
  let current = initial;
  let sequence = 0;
  const options = { now: () => current, id: () => `exposure_${++sequence}`, timeZone: 'Europe/Madrid' };
  const reopen = async () => {
    const store = await openAssessmentStore(root); stores.push(store);
    return { store, service: createAssessmentService(wrap(store), options) };
  };
  t.after(async () => { try { for (const store of stores) await store.close(); } finally { await fs.rm(parent, { recursive: true, force: true }); } });
  return { root, ...await reopen(), reopen, at(value: string) { current = value; } };
}
async function active(service: AssessmentService) {
  const draft = await service.createCheck({ id: 'check', operationId: 'create', expectedRevision: null, content: content() });
  return service.activateCheck({ id: 'check', operationId: 'activate', expectedRevision: draft.revision });
}
const opening = (checkExpectedRevision: number, id = 'attempt'): OpenAttemptRequest => ({ id, operationId: `open_${id}`, expectedRevision: null, checkId: 'check', checkExpectedRevision, episodeId: id, confidence: 80, help: 'none' });
async function frozen(service: AssessmentService, checkRevision: number, id = 'attempt') {
  const opened = await service.openAttempt(opening(checkRevision, id));
  const saved = await service.commandAttempt({ id, operationId: `save_${id}`, expectedRevision: opened.revision, command: { type: 'saveAnswer', answer: 'Immutable synthetic answer' } });
  return service.commandAttempt({ id, operationId: `freeze_${id}`, expectedRevision: saved.revision, command: { type: 'freeze' } });
}

test('real-store journey preserves answer, history, review queue and receipts across reopen', async t => {
  const f = await fixture(t);
  const check = await active(f.service);
  assert.equal(check.latest.reviewed, true); hidden(check);
  f.at('2026-01-03T12:00:00.000Z');
  const answer = await frozen(f.service, check.revision);
  hidden(answer); assert.equal(answer.status, 'frozen'); assert.match(answer.answerHash!, /^[a-f0-9]{64}$/);
  const reveal = await f.service.revealAttempt(answer.id);
  assert.equal(reveal.reference, REFERENCE); assert.deepEqual(reveal.rubric, [RUBRIC]);
  const graded = await f.service.commandAttempt({ id: answer.id, operationId: 'grade', expectedRevision: answer.revision, command: { type: 'grade', score: 'fluent', marks: ['met'], diagnosis: 'Self assessed' } });
  hidden(graded); assert.equal(graded.answerHash, answer.answerHash);
  assert.equal((await f.service.getCheck('check')).review?.dueDate, '2026-01-05');
  assert.equal((await f.service.getCheck('check')).review?.eligibleCount, 1);
  f.at('2026-01-05T12:00:00.000Z');
  const before = { history: await f.service.history('check'), queue: await f.service.queue(), checks: await f.service.listChecks() };
  hidden(before); assert.equal(before.queue.length, 1);
  await f.store.close();
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.service.history('check'), before.history);
  assert.deepEqual(await reopened.service.queue(), before.queue);
  assert.deepEqual(await reopened.service.listChecks(), before.checks);
  const replay = await reopened.service.commandAttempt({ id: answer.id, operationId: 'grade', expectedRevision: answer.revision, command: { type: 'grade', score: 'fluent', marks: ['met'], diagnosis: 'Self assessed' } });
  assert.deepEqual(replay, graded);
});

test('every ordinary projection omits secrets before and after grading; returned copies detach', async t => {
  const f = await fixture(t); const check = await active(f.service);
  f.at('2026-01-03T12:00:00.000Z');
  const answer = await frozen(f.service, check.revision);
  await f.service.commandAttempt({ id: answer.id, operationId: 'grade', expectedRevision: answer.revision, command: { type: 'grade', score: 'partial', marks: ['partial'], diagnosis: '' } });
  hidden(await f.service.getCheck('check')); hidden(await f.service.listChecks());
  hidden(await f.service.getAttempt(answer.id)); hidden(await f.service.history('check')); hidden(await f.service.queue());
  const external = await f.service.getAttempt(answer.id); external.question.prompt = 'Outside'; external.grades[0]!.marks[0] = 'missing';
  assert.equal((await f.service.getAttempt(answer.id)).question.prompt, 'What is the rule?');
  assert.equal((await f.service.getAttempt(answer.id)).grades[0]!.marks[0], 'partial');
});

test('authoring, edit and every repeated reveal persist fresh exposure before returning content', async t => {
  const f = await fixture(t); const check = await active(f.service);
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.lastExposedAt, initial);
  f.at('2026-01-02T12:00:00.000Z');
  const edited = await f.service.editCheck('check'); assert.equal(edited.content.reference, REFERENCE);
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.lastExposedAt, '2026-01-02T12:00:00.000Z');
  f.at('2026-01-04T12:00:00.000Z');
  const answer = await frozen(f.service, edited.check.revision);
  await f.service.revealAttempt(answer.id);
  f.at('2026-01-05T12:00:00.000Z'); await f.service.revealAttempt(answer.id);
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.lastExposedAt, '2026-01-05T12:00:00.000Z');
  assert.ok((await f.service.getCheck('check')).revision > edited.check.revision);
  assert.equal(check.activeRevision, 1);
});

test('reveal is barred before freeze and exposure persistence failure yields no reference-bearing success', async t => {
  let fail = false;
  const f = await fixture(t, store => new Proxy(store, { get(target, key) {
    if (key === 'commit') return (...args: unknown[]) => {
      if (fail && args[0] === 'checks') return Promise.reject(new Error('Synthetic exposure write failure'));
      return Reflect.apply(target.commit, target, args);
    };
    return Reflect.get(target, key);
  } }));
  const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const opened = await f.service.openAttempt(opening(check.revision));
  await assert.rejects(f.service.revealAttempt(opened.id), code('INVALID_TRANSITION'));
  const answer = await f.service.commandAttempt({ id: opened.id, operationId: 'freeze', expectedRevision: opened.revision, command: { type: 'freeze' } });
  fail = true;
  await assert.rejects(f.service.revealAttempt(answer.id), /Synthetic exposure write failure/);
  await assert.rejects(f.service.editCheck('check'), /Synthetic exposure write failure/);
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.lastExposedAt, initial);
  hidden(await f.service.getAttempt(answer.id));
  fail = false; assert.equal((await f.service.revealAttempt(answer.id)).reference, REFERENCE);
});

test('concurrent reveal then opening is serialized and snapshots the new exposure', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const answer = await frozen(f.service, check.revision);
  const oldRevision = (await f.service.getCheck('check')).revision;
  const reveal = f.service.revealAttempt(answer.id);
  const stale = f.service.openAttempt(opening(oldRevision, 'stale'));
  await reveal; await assert.rejects(stale, code('CONFLICT'));
  assert.equal(await f.store.read('attempts', 'stale'), null);
  const updated = await f.service.getCheck('check');
  const fresh = await f.service.openAttempt(opening(updated.revision, 'fresh'));
  assert.equal(fresh.lastExposedAt, '2026-01-03T12:00:00.000Z');
  assert.equal((await f.service.getCheck('check')).review?.eligibleAt, '2026-01-04T12:00:00.000Z');
});

test('stable client IDs and canonical request hashes replay latest state, including after check changes', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const request = opening(check.revision); const opened = await f.service.openAttempt(request);
  const saved = await f.service.commandAttempt({ id: opened.id, operationId: 'save', expectedRevision: opened.revision, command: { type: 'saveAnswer', answer: 'A' } });
  const finished = await f.service.commandAttempt({ id: opened.id, operationId: 'freeze_before_revision', expectedRevision: saved.revision, command: { type: 'freeze' } });
  await f.service.reviseCheck({ id: 'check', operationId: 'revise', expectedRevision: check.revision, content: { ...content(), prompt: 'New question' } });
  f.at('2026-01-04T12:00:00.000Z');
  const reordered: OpenAttemptRequest = { help: 'none', confidence: 80, episodeId: 'attempt', checkExpectedRevision: check.revision, checkId: 'check', expectedRevision: null, operationId: 'open_attempt', id: 'attempt' };
  assert.deepEqual(await f.service.openAttempt(reordered), finished);
  assert.equal((await f.service.history('check')).length, 1);
  await assert.rejects(f.service.openAttempt({ ...request, confidence: 81 }), code('CONFLICT'));
  await assert.rejects(f.service.openAttempt({ ...request, checkExpectedRevision: check.revision + 1 }), code('CONFLICT'));
  const replayCreate = await f.service.createCheck({ content: content(), expectedRevision: null, operationId: 'create', id: 'check' });
  assert.equal(replayCreate.latest.revision, 2);
  await assert.rejects(f.service.createCheck({ id: 'check', operationId: 'create', expectedRevision: null, content: { ...content(), title: 'Changed' } }), code('CONFLICT'));
});

test('stale OCC, draft-only checks and repeated activation cause no effects', async t => {
  const f = await fixture(t);
  const draft = await f.service.createCheck({ id: 'check', operationId: 'create', expectedRevision: null, content: content() });
  await assert.rejects(f.service.openAttempt(opening(draft.revision)), code('INVALID_TRANSITION'));
  const check = await f.service.activateCheck({ id: 'check', operationId: 'activate', expectedRevision: draft.revision });
  await assert.rejects(f.service.activateCheck({ id: 'check', operationId: 'again', expectedRevision: check.revision }), code('INVALID_TRANSITION'));
  await assert.rejects(f.service.archiveCheck({ id: 'check', operationId: 'stale', expectedRevision: draft.revision }), code('CONFLICT'));
  assert.deepEqual(await f.service.activateCheck({ id: 'check', operationId: 'activate', expectedRevision: draft.revision }), check);
  assert.equal((await f.service.history('check')).length, 0);
});

test('revisions keep active old snapshot until activation; archive bars new attempts but preserves completion', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const opened = await f.service.openAttempt(opening(check.revision));
  const frozenOld = await f.service.commandAttempt({ id: opened.id, operationId: 'freeze', expectedRevision: opened.revision, command: { type: 'freeze' } });
  const revised = await f.service.reviseCheck({ id: 'check', operationId: 'revise', expectedRevision: check.revision, content: { ...content(), prompt: 'New question', reference: 'NEW_REFERENCE', rubric: ['NEW_RUBRIC'] } });
  assert.equal(revised.activeRevision, 1); assert.equal(revised.latest.revision, 2); assert.equal(revised.latest.reviewed, false);
  const beforeActivation = await f.service.openAttempt(opening(revised.revision, 'old_snapshot'));
  assert.equal(beforeActivation.question.prompt, 'What is the rule?');
  await f.service.commandAttempt({ id: beforeActivation.id, operationId: 'abandon_old_snapshot', expectedRevision: beforeActivation.revision, command: { type: 'abandon' } });
  const activated = await f.service.activateCheck({ id: 'check', operationId: 'activate_new', expectedRevision: revised.revision });
  const fresh = await f.service.openAttempt(opening(activated.revision, 'new_snapshot'));
  assert.equal(fresh.question.prompt, 'New question');
  const archived = await f.service.archiveCheck({ id: 'check', operationId: 'archive', expectedRevision: activated.revision });
  assert.equal(archived.review, null);
  await assert.rejects(f.service.openAttempt(opening(archived.revision, 'archived')), code('INVALID_TRANSITION'));
  await f.service.commandAttempt({ id: fresh.id, operationId: 'freeze_archived_snapshot', expectedRevision: fresh.revision, command: { type: 'freeze' } });
  assert.equal((await f.service.revealAttempt(frozenOld.id)).reference, REFERENCE);
  await f.service.commandAttempt({ id: opened.id, operationId: 'grade', expectedRevision: frozenOld.revision, command: { type: 'grade', score: 'cant', marks: ['missing'], diagnosis: '' } });
  assert.deepEqual(await f.service.queue(), []);
});

test('correction retains immutable frozen answer and original grade; grade rejects hidden answer fields', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const answer = await frozen(f.service, check.revision);
  const grade = { type: 'grade' as const, score: 'fluent' as const, marks: ['met' as const], diagnosis: '' };
  await assert.rejects(f.service.commandAttempt({ id: answer.id, operationId: 'bad_grade', expectedRevision: answer.revision, command: { ...grade, answer: 'Overwrite' } } as Parameters<AssessmentService['commandAttempt']>[0]), code('INVALID_INPUT'));
  const graded = await f.service.commandAttempt({ id: answer.id, operationId: 'grade', expectedRevision: answer.revision, command: grade });
  f.at('2026-01-10T12:00:00.000Z');
  const corrected = await f.service.commandAttempt({ id: answer.id, operationId: 'correction', expectedRevision: graded.revision, command: { type: 'correctGrade', score: 'cant', marks: ['missing'], diagnosis: 'Correction' } });
  assert.equal(corrected.answer, answer.answer); assert.equal(corrected.answerHash, answer.answerHash); assert.equal(corrected.frozenAt, answer.frozenAt);
  assert.equal(corrected.grades.length, 2); assert.deepEqual(corrected.grades[0], graded.grades[0]);
  assert.equal((await f.service.getCheck('check')).review?.dueDate, '2026-01-05');
  await assert.rejects(f.service.commandAttempt({ id: answer.id, operationId: 'save_after_freeze', expectedRevision: corrected.revision, command: { type: 'saveAnswer', answer: 'B' } }), code('INVALID_TRANSITION'));
});

test('strict unexpected keys, NaN, bad clocks and options write no records', async t => {
  const f = await fixture(t);
  const request: CreateCheckRequest = { id: 'check', operationId: 'create', expectedRevision: null, content: content() };
  await assert.rejects(f.service.createCheck({ ...request, extra: true } as CreateCheckRequest), code('INVALID_INPUT'));
  await assert.rejects(f.service.createCheck({ ...request, content: { ...content(), extra: true } } as CreateCheckRequest), code('INVALID_INPUT'));
  f.at('bad time'); await assert.rejects(f.service.createCheck(request), code('INVALID_INPUT'));
  assert.deepEqual(await f.store.list('checks'), []);
  f.at(initial); const check = await active(f.service);
  await assert.rejects(f.service.openAttempt({ ...opening(check.revision), confidence: NaN }), code('INVALID_INPUT'));
  await assert.rejects(f.service.openAttempt({ ...opening(check.revision), help: 'other' } as unknown as OpenAttemptRequest), code('INVALID_INPUT'));
  assert.deepEqual(await f.store.list('attempts'), []);
  assert.throws(() => createAssessmentService(f.store, { now: () => initial, id: () => 'x', timeZone: 'Not/A_Zone' }), code('INVALID_INPUT'));
  assert.throws(() => createAssessmentService(f.store, { now: () => initial, id: () => 'x', timeZone: '' }), code('INVALID_INPUT'));
  assert.doesNotThrow(() => createAssessmentService(f.store, { now: () => initial, id: () => 'x', timeZone: 'UTC' }));
});

test('strict detached validation occurs before enqueue so caller mutation cannot alter a queued create', async t => {
  let block = false; let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, store => new Proxy(store, { get(target, key) {
    if (key === 'read') return async (...args: unknown[]) => {
      if (block) { block = false; entered(); await gate; }
      return Reflect.apply(target.read, target, args);
    };
    return Reflect.get(target, key);
  } }));
  await active(f.service); block = true;
  const read = f.service.getCheck('check'); await reached;
  const request: CreateCheckRequest = { id: 'queued', operationId: 'queued', expectedRevision: null, content: content() };
  const queued = f.service.createCheck(request);
  request.id = 'mutated'; request.content.title = 'Mutated'; request.content.rubric[0] = 'Mutated';
  release(); await read;
  const result = await queued; assert.equal(result.id, 'queued'); assert.equal(result.latest.title, 'Synthetic rule');
  assert.equal(await f.store.read('checks', 'mutated'), null);
  assert.deepEqual((await f.store.read<CheckRecord>('checks', 'queued'))!.revisions[0]!.rubric, [RUBRIC]);
});

test('existing-check IO errors and corrupt schema fail visibly without creating attempts or empty lists', async t => {
  let fail = false;
  const f = await fixture(t, store => new Proxy(store, { get(target, key) {
    if (key === 'read') return (...args: unknown[]) => {
      if (fail && args[0] === 'checks') return Promise.reject(new Error('Synthetic read failure'));
      return Reflect.apply(target.read, target, args);
    };
    return Reflect.get(target, key);
  } }));
  const check = await active(f.service); fail = true;
  await assert.rejects(f.service.openAttempt(opening(check.revision)), /Synthetic read failure/);
  assert.deepEqual(await f.store.list('attempts'), []); fail = false;
  await f.store.commit('checks', 'invalid', { operationId: 'invalid', expectedRevision: null, requestHash: 'invalid' }, () => ({ id: 'invalid', formatVersion: 1, revision: 1 }));
  await assert.rejects(f.service.listChecks(), code('INVALID_INPUT'));
  await assert.rejects(f.service.queue(), code('INVALID_INPUT'));
});

test('reused internal exposure IDs conflict at later revisions instead of replaying an older exposure', async t => {
  const f = await fixture(t);
  const service = createAssessmentService(f.store, { now: () => initial, id: () => 'reused_internal', timeZone: 'Europe/Madrid' });
  await active(service);
  const first = await service.editCheck('check');
  await assert.rejects(service.editCheck('check'), code('CONFLICT'));
  assert.equal((await service.getCheck('check')).revision, first.check.revision);
});

test('valid but backwards injected clock cannot erase later check exposure', async t => {
  const f = await fixture(t); await active(f.service);
  f.at('2026-01-05T12:00:00.000Z'); const exposed = await f.service.editCheck('check');
  f.at('2026-01-04T12:00:00.000Z');
  await assert.rejects(f.service.reviseCheck({ id: 'check', operationId: 'backwards', expectedRevision: exposed.check.revision, content: content() }), code('INVALID_INPUT'));
  await assert.rejects(f.service.editCheck('check'), code('INVALID_INPUT'));
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.lastExposedAt, '2026-01-05T12:00:00.000Z');
  assert.equal((await f.store.read<CheckRecord>('checks', 'check'))!.revision, exposed.check.revision);
});

test('cold open blocks edit and new revision without writes until every open answer is frozen or abandoned', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const first = await f.service.openAttempt(opening(check.revision, 'cold_first'));
  const second = await f.service.openAttempt(opening(check.revision, 'cold_second'));
  const beforeCheck = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  const beforeAttempts = await f.store.list('attempts');
  const revise = { id: 'check', operationId: 'blocked_revision', expectedRevision: check.revision, content: content() };
  await assert.rejects(f.service.editCheck('check'), code('INVALID_TRANSITION'));
  await assert.rejects(f.service.reviseCheck(revise), code('INVALID_TRANSITION'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), beforeCheck);
  assert.deepEqual(await f.store.list('attempts'), beforeAttempts);
  const frozenFirst = await f.service.commandAttempt({ id: first.id, operationId: 'freeze_first', expectedRevision: first.revision, command: { type: 'freeze' } });
  await assert.rejects(f.service.editCheck('check'), code('INVALID_TRANSITION'));
  await assert.rejects(f.service.revealAttempt(first.id), code('INVALID_TRANSITION'));
  await f.service.commandAttempt({ id: second.id, operationId: 'abandon_second', expectedRevision: second.revision, command: { type: 'abandon' } });
  // Same request/receipt ID succeeds after the rejected operation; no hidden receipt was written.
  const revised = await f.service.reviseCheck(revise); assert.equal(revised.latest.revision, 2);
  assert.equal((await f.service.editCheck('check')).content.reference, REFERENCE);
  assert.equal((await f.service.revealAttempt(first.id)).reference, REFERENCE);
  const unchanged = await f.service.getAttempt(first.id);
  assert.equal(unchanged.answerHash, frozenFirst.answerHash); assert.equal(unchanged.lastExposedAt, initial);
  assert.equal(unchanged.help, 'none'); assert.equal(unchanged.confidence, 80);
  await f.service.commandAttempt({ id: first.id, operationId: 'grade_after_unlock', expectedRevision: frozenFirst.revision, command: { type: 'grade', score: 'fluent', marks: ['met'], diagnosis: '' } });
  assert.equal((await f.service.getCheck('check')).review?.eligibleCount, 1);
});

test('cold open on a new content revision bars historical reveal until abandonment', async t => {
  const f = await fixture(t); const check = await active(f.service); f.at('2026-01-03T12:00:00.000Z');
  const old = await frozen(f.service, check.revision, 'historical');
  const draft = await f.service.reviseCheck({ id: 'check', operationId: 'revision_two', expectedRevision: check.revision,
    content: { ...content(), reference: 'NEW_REFERENCE', rubric: ['NEW_RUBRIC'] } });
  const revised = await f.service.activateCheck({ id: 'check', operationId: 'activate_two', expectedRevision: draft.revision });
  f.at('2026-01-05T12:00:00.000Z');
  const cold = await f.service.openAttempt(opening(revised.revision, 'cold_new_revision'));
  const before = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  await assert.rejects(f.service.revealAttempt(old.id), code('INVALID_TRANSITION'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
  assert.deepEqual(await f.service.getAttempt(cold.id), cold);
  await f.service.commandAttempt({ id: cold.id, operationId: 'abandon_cold', expectedRevision: cold.revision, command: { type: 'abandon' } });
  assert.equal((await f.service.revealAttempt(old.id)).reference, REFERENCE);
});

test('concurrent opening then exposure rejects exposure while another check remains unaffected', async t => {
  const f = await fixture(t); const check = await active(f.service);
  const other = await f.service.createCheck({ id: 'other', operationId: 'other', expectedRevision: null, content: content() });
  f.at('2026-01-03T12:00:00.000Z');
  const open = f.service.openAttempt(opening(check.revision));
  const edit = f.service.editCheck('check');
  await open; await assert.rejects(edit, code('INVALID_TRANSITION'));
  assert.equal((await f.service.editCheck(other.id)).content.reference, REFERENCE);
  assert.equal((await f.service.getCheck('check')).revision, check.revision);
});

test('already committed revision retries replay after a later open but new revisions reject', async t => {
  const f = await fixture(t); const check = await active(f.service);
  const request = { id: 'check', operationId: 'precommitted_revision', expectedRevision: check.revision, content: content() };
  const revised = await f.service.reviseCheck(request);
  f.at('2026-01-03T12:00:00.000Z'); await f.service.openAttempt(opening(revised.revision));
  const before = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  assert.deepEqual(await f.service.reviseCheck(request), revised);
  await assert.rejects(f.service.reviseCheck({ ...request, operationId: 'new_revision', expectedRevision: revised.revision }), code('INVALID_TRANSITION'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
});

test('failed or corrupt attempt enumeration bars all reference exposure and revision writes', async t => {
  let fail = false;
  const f = await fixture(t, store => new Proxy(store, { get(target, key) {
    if (key === 'list') return (...args: unknown[]) => {
      if (fail && args[0] === 'attempts') return Promise.reject(new Error('Synthetic attempt enumeration failure'));
      return Reflect.apply(target.list, target, args);
    };
    return Reflect.get(target, key);
  } }));
  const check = await active(f.service); const old = await frozen(f.service, check.revision);
  const before = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  const request = { id: 'check', operationId: 'blocked_enumeration', expectedRevision: check.revision, content: content() };
  fail = true;
  await assert.rejects(f.service.editCheck('check'), /Synthetic attempt enumeration failure/);
  await assert.rejects(f.service.revealAttempt(old.id), /Synthetic attempt enumeration failure/);
  await assert.rejects(f.service.reviseCheck(request), /Synthetic attempt enumeration failure/);
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
  fail = false;
  await f.store.commit('attempts', 'invalid', { operationId: 'invalid', expectedRevision: null, requestHash: 'invalid' }, () => ({ id: 'invalid', formatVersion: 1, revision: 1 }));
  await assert.rejects(f.service.editCheck('check'), code('INVALID_INPUT'));
  await assert.rejects(f.service.revealAttempt(old.id), code('INVALID_INPUT'));
  await assert.rejects(f.service.reviseCheck(request), code('INVALID_INPUT'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
});
