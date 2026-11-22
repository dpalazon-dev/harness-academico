import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import { createPracticeService } from '../src/practice/service.ts';
import { tempStore, unit } from './study-fixtures.ts';

const TASK = { prompt: 'Explica la derivada.', cues: ['c1', 'c2', 'c3', 'c4', 'c5'], reference: 'REFERENCIA-SECRETA', rubric: ['Cociente', 'Límite'] };
const JUDGE = { fidelity: 2, failureType: 'precision', rationale: 'Falta el límite.' };

function fixture(t: TestContext, { judge = JSON.stringify(JUDGE) as string | null, throwJudge = false, task = JSON.stringify(TASK) } = {}) {
  const store = tempStore(t);
  let clock = Date.UTC(2026, 10, 11, 9);
  let n = 0;
  const calls: string[] = [];
  const inference = {
    async catalog() { return { slots: { strong: { model: { provider: 'p', id: 'm' } } } }; },
    async complete(request: { context: { systemPrompt: string } }) {
      const isJudge = request.context.systemPrompt.includes('contraste');
      calls.push(isJudge ? 'judge' : 'task');
      if (isJudge && throwJudge) throw new Error('network down');
      if (isJudge && judge === null) return { role: 'assistant', stopReason: 'error', errorMessage: 'caído', content: [] };
      return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: isJudge ? judge : task }] };
    },
  } as unknown as PluginInference;
  const service = createPracticeService(store, {
    inference, now: () => new Date(clock += 60_000).toISOString(), newId: () => `id${++n}`, timeZone: 'Europe/Madrid', signal: new AbortController().signal,
  });
  store.saveUnit(unit({ id: 'u1', createdAt: '2026-11-10T09:00:00.000Z', origin: { kind: 'sondeo', chatId: 'chat-1' } }), null);
  return { store, service, calls, advance: (ms: number) => { clock += ms; } };
}

test('a full attempt: start, cue, answer, freeze with contrast, self-grade', async t => {
  const f = fixture(t);
  assert.deepEqual(f.service.today().queue.map(q => [q.unitId, q.nextTaskKind]), [['u1', 'libre']]);
  const started = await f.service.start({ unitId: 'u1', confidence: 70 });
  assert.equal(JSON.stringify(started).includes('REFERENCIA-SECRETA'), false);
  const attemptId = started.attempt.id;
  assert.deepEqual(f.service.cue({ attemptId }).cues, ['c1']);
  f.service.saveAnswer({ attemptId, answer: 'cociente incremental' });
  const frozen = await f.service.freeze({ attemptId });
  assert.equal(frozen.warning, null);
  assert.equal(frozen.attempt.reference, 'REFERENCIA-SECRETA');
  assert.equal(frozen.attempt.attempt.judgments[0]?.failureType, 'precision');
  const graded = f.service.grade({ attemptId, fidelity: 2, failureType: 'precision' });
  assert.equal(graded.attempt.status, 'graded');
  assert.equal(f.store.getExposures('u1')?.instants.length, 1);
  assert.deepEqual(f.calls, ['task', 'judge']);
  assert.deepEqual(f.service.today().queue, []);
});

test('starting again while an attempt is unfinished resumes it instead of generating a new task', async t => {
  const f = fixture(t);
  const first = await f.service.start({ unitId: 'u1', confidence: 50 });
  const again = await f.service.start({ unitId: 'u1', confidence: 90 });
  assert.equal(again.attempt.id, first.attempt.id);
  assert.deepEqual(f.calls, ['task']);
  assert.deepEqual(f.service.today().open.map(o => o.attempt.id), [first.attempt.id]);
  assert.deepEqual(f.service.today().queue, []);
});

test('a failed contrast leaves the attempt frozen and gradable, with a warning', async t => {
  const f = fixture(t, { judge: null });
  const { attempt } = await f.service.start({ unitId: 'u1', confidence: 50 });
  const frozen = await f.service.freeze({ attemptId: attempt.id });
  assert.match(frozen.warning ?? '', /contraste válido.*autoevaluar/);
  assert.equal(frozen.attempt.attempt.status, 'frozen');
  assert.equal(f.service.grade({ attemptId: attempt.id, fidelity: 1, failureType: null }).attempt.status, 'graded');
});

test('opening the source freezes the attempt as not recalled and goes to the contrast', async t => {
  const f = fixture(t);
  const { attempt } = await f.service.start({ unitId: 'u1', confidence: 50 });
  const result = await f.service.openSource({ attemptId: attempt.id });
  assert.equal(result.attempt.attempt.status, 'frozen');
  assert.equal(result.attempt.attempt.cueLevelAtFreeze, 6);
  assert.equal(result.attempt.reference, 'REFERENCIA-SECRETA');
  assert.equal(f.store.getExposures('u1')?.instants.length, 1);
  assert.throws(() => f.service.abandon({ attemptId: attempt.id }), /frozen/);
});

test('a native session turn exposes the units that came from that chat', t => {
  const f = fixture(t);
  assert.equal(f.service.recordSessionExposure('chat-1'), 1);
  assert.equal(f.service.recordSessionExposure('other'), 0);
  assert.equal(f.store.getExposures('u1')?.instants.length, 1);
});

test('inputs are validated and unknown attempts or inactive units are refused', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.start({ unitId: 'u1', confidence: 101 }), /confidence/);
  await assert.rejects(f.service.start({ unitId: 'nope', confidence: 5 }), /does not exist/);
  assert.throws(() => f.service.cue({ attemptId: 'nope' }), /does not exist/);
  assert.throws(() => f.service.grade({ attemptId: 'x', fidelity: 2, extra: 1 }), /not allowed/);
});

test('a judge that throws a plain error still leaves a frozen, gradable attempt', async t => {
  const f = fixture(t, { throwJudge: true });
  const { attempt } = await f.service.start({ unitId: 'u1', confidence: 50 });
  const frozen = await f.service.freeze({ attemptId: attempt.id });
  assert.match(frozen.warning ?? '', /network down.*autoevaluar/);
  assert.equal(frozen.attempt.attempt.status, 'frozen');
});

test('a malformed task from the model writes neither a task nor an attempt', async t => {
  const f = fixture(t, { task: '{"prompt": "x"' });
  await assert.rejects(f.service.start({ unitId: 'u1', confidence: 50 }), /tarea válida/);
  assert.deepEqual(f.store.listTasks(), []);
  assert.deepEqual(f.store.listAttempts(), []);
});
