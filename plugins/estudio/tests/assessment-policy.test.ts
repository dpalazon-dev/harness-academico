import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveReview } from '../src/assessment/policy.ts';
import { buildQueue } from '../src/assessment/queue.ts';
import { calibrate } from '../src/assessment/calibration.ts';
import type { AttemptAggregate, CheckRecord, GradeEvent, ReviewState, Score } from '../src/assessment/types.ts';

const now = '2026-12-01T12:00:00.000Z';

function check(overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id: 'check_1', formatVersion: 1, revision: 1,
    createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
    archived: false, activeRevision: 1, lastExposedAt: '2026-01-01T12:00:00.000Z',
    revisions: [{ revision: 1, title: 'Synthetic check', objective: 'Explain a synthetic rule',
      type: 'explain', prompt: 'Explain the rule', reference: 'Synthetic reference',
      rubric: ['States the rule'], reviewed: true, createdAt: '2026-01-01T12:00:00.000Z',
      activatedAt: '2026-01-01T12:00:00.000Z', reviewPolicyVersion: 1 }],
    ...overrides,
  };
}

function grade(score: Score, gradedAt: string, correction = false): GradeEvent {
  return { score, marks: [score === 'fluent' ? 'met' : score === 'partial' ? 'partial' : 'missing'],
    diagnosis: 'Synthetic observation', gradedAt, evaluator: 'self', correction };
}

function attempt(id: string, frozenAt: string, score: Score, overrides: Partial<AttemptAggregate> = {}): AttemptAggregate {
  return {
    id, formatVersion: 1, revision: 3, checkId: 'check_1', checkRevision: 1,
    reviewPolicyVersion: 1, episodeId: id, timeZone: 'Europe/Madrid',
    openedAt: frozenAt, frozenAt, status: 'graded', confidence: 80, help: 'none',
    lastExposedAt: '2026-01-01T12:00:00.000Z', snapshot: structuredClone(check().revisions[0]!),
    answer: 'Synthetic answer', answerHash: '0'.repeat(64), grades: [grade(score, frozenAt)],
    ...overrides,
  };
}

test('activation initializes +2 local days, first fluent advances -1 to 0 and +2', () => {
  const initial = deriveReview(check(), [], now)!;
  assert.equal(initial.state, 'not_started');
  assert.equal(initial.step, -1);
  assert.equal(initial.dueDate, '2026-01-03');
  assert.equal(initial.eligibleAt, '2026-01-02T12:00:00.000Z');
  const result = deriveReview(check(), [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent')], now)!;
  assert.equal(result.state, 'proficient');
  assert.equal(result.step, 0);
  assert.equal(result.dueDate, '2026-01-05');
  assert.equal(result.eligibleCount, 1);
});

test('ladder progresses 2/7/21/60 while same episode never proves retention', () => {
  const history = ['03', '04', '05', '06', '15'].map((day, i) =>
    attempt(`a${i}`, `2026-01-${day}T12:00:00.000Z`, 'fluent', { episodeId: 'one_episode' }));
  assert.equal(deriveReview(check(), history.slice(0, 2), now)!.dueDate, '2026-01-11');
  assert.equal(deriveReview(check(), history.slice(0, 3), now)!.dueDate, '2026-01-26');
  const result = deriveReview(check(), history, now)!;
  assert.equal(result.step, 3);
  assert.equal(result.state, 'proficient');
  assert.equal(result.dueDate, '2026-03-16');
});

test('different episodes separated by >=7 local days establish durable; same day does not', () => {
  const first = attempt('a', '2026-03-28T23:30:00.000Z', 'fluent'); // Madrid March 29
  assert.equal(deriveReview(check(), [first, attempt('b', '2026-04-04T22:30:00.000Z', 'fluent')], now)!.state, 'durable');
  assert.equal(deriveReview(check(), [first, attempt('b', '2026-04-04T20:30:00.000Z', 'fluent')], now)!.state, 'proficient');
  assert.equal(deriveReview(check(), [first, attempt('b', '2026-03-29T01:30:00.000Z', 'fluent')], now)!.state, 'proficient');
});

test('historical schedule uses the attempt zone, activation uses the profile zone', () => {
  const event = attempt('a', '2026-01-03T00:30:00.000Z', 'fluent', { timeZone: 'America/New_York' });
  assert.equal(deriveReview(check(), [event], now, 'Europe/Madrid')!.dueDate, '2026-01-04');
});

test('both eligible partial and cant revoke durable and reset the success sequence', () => {
  for (const score of ['partial', 'cant'] as const) {
    const history = [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent'), attempt('b', '2026-01-10T12:00:00.000Z', 'fluent')];
    assert.equal(deriveReview(check(), history, now)!.state, 'durable');
    history.push(attempt('c', '2026-01-11T12:00:00.000Z', score));
    const failure = deriveReview(check(), history, now)!;
    assert.equal(failure.state, score === 'cant' ? 'attempted' : 'familiar');
    assert.equal(failure.step, -1);
    assert.equal(failure.dueDate, '2026-01-13');
    history.push(attempt('d', '2026-01-12T12:00:00.000Z', 'fluent'));
    assert.equal(deriveReview(check(), history, now)!.state, 'proficient');
    assert.equal(deriveReview(check(), history, now)!.step, 0);
  }
});

test('23:59 exposure is practice; exactly 24 actual hours is eligible even across DST', () => {
  const exposure = '2026-03-28T12:00:00.000Z';
  const warm = attempt('warm', '2026-03-29T11:59:00.000Z', 'fluent', { lastExposedAt: exposure });
  const cold = attempt('cold', '2026-03-29T12:00:00.000Z', 'fluent', { lastExposedAt: exposure });
  assert.equal(deriveReview(check(), [warm], now)!.eligibleCount, 0);
  assert.equal(deriveReview(check(), [cold], now)!.eligibleCount, 1);
});

test('unknown exposure and a warm opening held past cooldown remain practice', () => {
  const unknown = attempt('unknown', '2026-01-03T12:00:00.000Z', 'fluent', { lastExposedAt: null });
  const held = attempt('held', '2026-01-03T12:00:00.000Z', 'fluent', {
    openedAt: '2026-01-02T11:59:00.000Z', lastExposedAt: '2026-01-01T12:00:00.000Z',
  });
  assert.equal(deriveReview(check(), [unknown, held], now)!.eligibleCount, 0);
  assert.equal(deriveReview(check({ lastExposedAt: null }), [], now)!.eligibleAt, null);
});

test('current exposure changes next eligibility without retroactively invalidating a frozen attempt', () => {
  const current = check({ lastExposedAt: '2026-01-05T12:00:00.000Z' });
  const result = deriveReview(current, [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent')], now)!;
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.eligibleAt, '2026-01-06T12:00:00.000Z');
});

test('assisted or unknown-help attempts remain practice and cannot postpone a due date', () => {
  for (const help of ['hint', 'partial_solution', 'solution', 'unknown'] as const) {
    const history = [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent'), attempt('b', '2026-01-20T12:00:00.000Z', 'fluent', { help })];
    const result = deriveReview(check(), history, now)!;
    assert.equal(result.dueDate, '2026-01-05');
    assert.equal(result.eligibleCount, 1);
    assert.equal(result.step, 0);
  }
});

test('practice may pull a future review forward and marks failure for verification', () => {
  const history = [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent'), attempt('b', '2026-01-10T12:00:00.000Z', 'fluent')];
  history.push(attempt('c', '2026-01-11T12:00:00.000Z', 'partial', { help: 'hint' }));
  const result = deriveReview(check(), history, now)!;
  assert.equal(result.state, 'durable');
  assert.equal(result.needsVerification, true);
  assert.equal(result.dueDate, '2026-01-13');
  history.push(attempt('practice_fluent', '2026-01-11T14:00:00.000Z', 'fluent', { help: 'hint' }));
  assert.equal(deriveReview(check(), history, now)!.needsVerification, true);
  history.push(attempt('d', '2026-01-12T12:00:00.000Z', 'fluent'));
  assert.equal(deriveReview(check(), history, now)!.needsVerification, false);
});

test('late grades and corrections replay the frozen position with a stable ID tie breaker', () => {
  const a = attempt('a', '2026-01-03T12:00:00.000Z', 'cant', {
    grades: [grade('cant', '2026-01-20T12:00:00.000Z'), grade('fluent', '2026-01-25T12:00:00.000Z', true)],
  });
  const b = attempt('b', '2026-01-10T12:00:00.000Z', 'fluent');
  const original = structuredClone([a, b]);
  const result = deriveReview(check(), [b, a], now)!;
  assert.equal(result.state, 'durable');
  assert.equal(result.dueDate, '2026-03-11');
  assert.equal(result.eligibleCount, 2);
  assert.deepEqual([a, b], original);
  const sameInstantFailure = attempt('z', b.frozenAt!, 'partial');
  assert.equal(deriveReview(check(), [sameInstantFailure, b, a], now)!.state, 'familiar');
});

test('open/frozen/abandoned attempts do not move state or schedule', () => {
  for (const status of ['open', 'frozen', 'abandoned'] as const) {
    const item = attempt('a', '2026-01-03T12:00:00.000Z', 'fluent', { status, grades: [], frozenAt: status === 'frozen' ? '2026-01-03T12:00:00.000Z' : null });
    assert.deepEqual(deriveReview(check(), [item], now), deriveReview(check(), [], now));
  }
});

test('archived, draft and superseded revisions cannot promote active state', () => {
  assert.equal(deriveReview(check({ archived: true }), [], now), null);
  assert.equal(deriveReview(check({ activeRevision: null }), [], now), null);
  const draft = check(); draft.revisions[0]!.reviewed = false;
  assert.equal(deriveReview(draft, [], now), null);
  const old = attempt('old', '2026-01-03T12:00:00.000Z', 'fluent', { checkRevision: 2 });
  assert.equal(deriveReview(check(), [old], now)!.eligibleCount, 0);
});

test('a draft snapshot remains historical after its content revision is activated', () => {
  const draftAttempt = attempt('draft_history', '2026-01-03T12:00:00.000Z', 'cant');
  draftAttempt.snapshot.reviewed = false;
  draftAttempt.snapshot.activatedAt = null;
  const cold = attempt('a', '2026-01-10T12:00:00.000Z', 'fluent');
  const second = attempt('b', '2026-01-17T12:00:00.000Z', 'fluent');
  const latestDraft = structuredClone(draftAttempt);
  latestDraft.id = 'draft_late';
  latestDraft.openedAt = latestDraft.frozenAt = '2026-01-20T12:00:00.000Z';
  latestDraft.grades = [grade('cant', '2026-01-20T12:00:00.000Z')];
  assert.deepEqual(deriveReview(check(), [cold, second, latestDraft], now), deriveReview(check(), [cold, second], now));
  assert.deepEqual(calibrate(check(), [draftAttempt]), { n: 0, brier: null });
});

test('policy and format versions fail closed and supplied clock must be canonical', () => {
  const unsupported = check(); unsupported.revisions[0]!.reviewPolicyVersion = 2 as 1;
  assert.throws(() => deriveReview(unsupported, [], now));
  assert.throws(() => deriveReview({ ...check(), formatVersion: 2 as 1 }, [], now));
  const unknown = attempt('a', '2026-01-03T12:00:00.000Z', 'fluent', { reviewPolicyVersion: 2 as 1 });
  assert.throws(() => deriveReview(check(), [unknown], now));
  assert.throws(() => deriveReview(check(), [], '2026-01-01'));
  assert.throws(() => deriveReview(check(), [attempt('bad', '2026-01-03T12:00:00.000Z', 'other' as Score)], now));
  assert.throws(() => deriveReview(check(), [attempt('bad', '2026-01-03T12:00:00.000Z', 'fluent', { confidence: NaN })], now));
  assert.throws(() => deriveReview(check(), [attempt('bad', '2026-01-03T12:00:00.000Z', 'fluent', { frozenAt: '2026-01-02T12:00:00.000Z' })], now));
});

test('calibration uses eligible current latest grades; n=2 and Brier .04', () => {
  const history = [attempt('a', '2026-01-03T12:00:00.000Z', 'fluent', { confidence: 80 }),
    attempt('b', '2026-01-04T12:00:00.000Z', 'cant', { confidence: 20 }),
    attempt('warm', '2026-01-05T12:00:00.000Z', 'cant', { help: 'hint' }),
    attempt('old', '2026-01-05T12:00:00.000Z', 'cant', { checkRevision: 2 })];
  const result = calibrate(check(), history);
  assert.equal(result.n, 2);
  assert.ok(Math.abs(result.brier! - 0.04) < 1e-12);
  assert.deepEqual(calibrate(check(), []), { n: 0, brier: null });
  history[0]!.grades.push(grade('cant', '2026-01-10T12:00:00.000Z', true));
  assert.ok(Math.abs(calibrate(check(), history).brier! - 0.34) < 1e-12);
  assert.deepEqual(calibrate(check({ archived: true }), history), { n: 0, brier: null });
});

test('duplicate copies cannot inflate mastery or calibration; conflicting copies reject', () => {
  const a = attempt('a', '2026-01-03T12:00:00.000Z', 'fluent');
  assert.equal(deriveReview(check(), [a, structuredClone(a)], now)!.eligibleCount, 1);
  assert.equal(calibrate(check(), [a, structuredClone(a)]).n, 1);
  assert.throws(() => deriveReview(check(), [a, { ...a, confidence: 20 }], now));
});

test('queue returns due only, oldest first then confidence then ID, without mutation', () => {
  const base = deriveReview(check(), [], now)!;
  const states: ReviewState[] = [
    { ...base, checkId: 'z', dueDate: '2026-01-03', lastConfidence: 90 },
    { ...base, checkId: 'future', dueDate: '2026-01-05' },
    { ...base, checkId: 'b', dueDate: '2026-01-03', lastConfidence: 20 },
    { ...base, checkId: 'no_date', dueDate: null },
    { ...base, checkId: 'a', dueDate: '2026-01-03', lastConfidence: 90 },
    { ...base, checkId: 'oldest', dueDate: '2026-01-01' },
  ];
  const before = structuredClone(states);
  assert.deepEqual(buildQueue(states, '2026-01-04').map(row => row.checkId), ['oldest', 'a', 'z', 'b']);
  assert.deepEqual(states, before);
  assert.throws(() => buildQueue(states, '2026-02-30'));
});
