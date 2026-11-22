import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseAttempt, parseAttemptCommand, parseCheck } from '../src/assessment/schema.ts';
import { transitionAttempt } from '../src/assessment/transitions.ts';
import type { AttemptAggregate, CheckRecord } from '../src/assessment/types.ts';

const OPEN = '2026-10-26T10:00:00.000Z';
const FREEZE = '2026-10-26T10:01:00.000Z';
const GRADE = '2026-10-26T10:02:00.000Z';
const CORRECT = '2026-10-27T10:02:00.000Z';

function check(): CheckRecord {
  return { id: 'check_1', formatVersion: 1, revision: 1, createdAt: OPEN, updatedAt: OPEN,
    archived: false, activeRevision: 1, lastExposedAt: null, revisions: [{
      revision: 1, title: 'Balance', objective: 'Explain a balance', type: 'explain',
      prompt: 'Explain mass balance.', reference: 'Inputs minus outputs.', rubric: ['Names inputs', 'Names outputs'],
      reviewed: true, createdAt: OPEN, activatedAt: OPEN, reviewPolicyVersion: 1,
    }] };
}

function requiredEntry<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert.ok(value !== undefined, `Expected entry ${index} to exist`);
  return value;
}

function attempt(): AttemptAggregate {
  return { id: 'attempt_1', formatVersion: 1, revision: 1, checkId: 'check_1', checkRevision: 1,
    reviewPolicyVersion: 1, episodeId: 'episode_1', timeZone: 'Europe/Madrid', openedAt: OPEN,
    frozenAt: null, status: 'open', confidence: 80, help: 'none', lastExposedAt: null,
    snapshot: requiredEntry(check().revisions, 0), answer: 'A', answerHash: null, grades: [] };
}

const invalid = (fn: () => unknown, code = 'INVALID_INPUT') => assert.throws(fn, { code });
const grade = { type: 'grade' as const, score: 'fluent' as const, marks: ['met', 'met'] as const, diagnosis: 'Complete' };
const gradeCommand = () => ({ ...grade, marks: [...grade.marks] });

test('check parser deep copies data and nested rubric', () => {
  const input = check();
  const parsed = parseCheck(input);
  assert.deepEqual(parsed, input);
  requiredEntry(parsed.revisions, 0).rubric[0] = 'changed';
  assert.equal(requiredEntry(requiredEntry(input.revisions, 0).rubric, 0), 'Names inputs');
});

test('confidence rejects out of range, nonnumeric and nonfinite values', () => {
  for (const confidence of [-1, 101, NaN, Infinity, -Infinity, '80', null]) {
    invalid(() => parseAttempt({ ...attempt(), confidence }));
  }
  assert.equal(parseAttempt({ ...attempt(), confidence: 0 }).confidence, 0);
  assert.equal(parseAttempt({ ...attempt(), confidence: 100 }).confidence, 100);
});

test('strict objects reject unexpected, inherited and symbol fields', () => {
  invalid(() => parseCheck({ ...check(), extra: true }));
  invalid(() => parseCheck({ ...check(), revisions: [{ ...requiredEntry(check().revisions, 0), extra: true }] }));
  invalid(() => parseAttempt({ ...attempt(), extra: true }));
  invalid(() => parseAttempt({ ...attempt(), snapshot: { ...attempt().snapshot, extra: true } }));
  invalid(() => parseAttempt(Object.assign(Object.create({ injected: true }), attempt())));
  invalid(() => parseAttempt({ ...attempt(), [Symbol('hidden')]: true }));
});

test('identifiers, version numbers, statuses, timezone and canonical timestamps fail closed', () => {
  for (const id of ['', '../check', 'á', 'x'.repeat(81)]) invalid(() => parseCheck({ ...check(), id }));
  for (const field of ['id', 'checkId', 'episodeId']) invalid(() => parseAttempt({ ...attempt(), [field]: '../bad' }));
  for (const openedAt of ['2026-02-30T10:00:00.000Z', '2026-10-26T10:00:00Z', '2026-10-26T11:00:00.000+01:00', 'nonsense']) {
    invalid(() => parseAttempt({ ...attempt(), openedAt }));
  }
  invalid(() => parseCheck({ ...check(), formatVersion: 2 }), 'UNSUPPORTED_FORMAT');
  invalid(() => parseAttempt({ ...attempt(), reviewPolicyVersion: 2 }), 'UNSUPPORTED_FORMAT');
  invalid(() => parseCheck({ ...check(), revisions: [{ ...requiredEntry(check().revisions, 0), reviewPolicyVersion: 2 }] }), 'UNSUPPORTED_FORMAT');
  for (const revision of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) invalid(() => parseCheck({ ...check(), revision }));
  invalid(() => parseAttempt({ ...attempt(), status: 'done' }));
  invalid(() => parseAttempt({ ...attempt(), timeZone: 'Not/A_Zone' }));
  invalid(() => parseAttempt({ ...attempt(), timeZone: '+01:00' }));
});

test('content limits reject empty or oversized rubric and excessive text', () => {
  for (const rubric of [[], Array(101).fill('criterion'), [''], ['x'.repeat(2001)]]) {
    invalid(() => parseCheck({ ...check(), revisions: [{ ...requiredEntry(check().revisions, 0), rubric }] }));
  }
  for (const [field, maximum] of [['objective', 2000], ['prompt', 20000], ['reference', 100000]] as const) {
    invalid(() => parseCheck({ ...check(), revisions: [{ ...requiredEntry(check().revisions, 0), [field]: 'x'.repeat(maximum + 1) }] }));
  }
  invalid(() => parseAttempt({ ...attempt(), answer: 'x'.repeat(100001) }));
  invalid(() => parseAttemptCommand({ ...gradeCommand(), diagnosis: 'x'.repeat(4001) }));
});

test('check revision identity, activation and timeline must agree', () => {
  invalid(() => parseCheck({ ...check(), activeRevision: 2 }));
  invalid(() => parseCheck({ ...check(), revisions: [requiredEntry(check().revisions, 0), requiredEntry(check().revisions, 0)] }));
  invalid(() => parseCheck({ ...check(), revisions: [{ ...requiredEntry(check().revisions, 0), reviewed: false }] }));
  invalid(() => parseCheck({ ...check(), updatedAt: '2026-10-25T10:00:00.000Z' }));
  invalid(() => parseAttempt({ ...attempt(), checkRevision: 2 }));
  const draft = { ...attempt(), snapshot: { ...attempt().snapshot, reviewed: false, activatedAt: null } };
  assert.equal(parseAttempt(draft).snapshot.reviewed, false);
});

test('save then freeze then grade preserves answer, hash, confidence and historical freeze time', () => {
  const original = attempt();
  const saved = transitionAttempt(original, { type: 'saveAnswer', answer: 'Answer α' }, OPEN);
  assert.equal(original.answer, 'A');
  assert.equal(saved.revision, 2);
  const frozen = transitionAttempt(saved, { type: 'freeze' }, FREEZE);
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.answerHash, createHash('sha256').update('Answer α', 'utf8').digest('hex'));
  assert.equal(frozen.frozenAt, FREEZE);
  assert.equal(frozen.revision, 3);
  const graded = transitionAttempt(frozen, gradeCommand(), GRADE);
  assert.equal(graded.status, 'graded');
  assert.equal(graded.revision, 4);
  assert.equal(graded.answer, 'Answer α');
  assert.equal(graded.confidence, 80);
  assert.equal(graded.frozenAt, FREEZE);
  assert.deepEqual(graded.grades, [{ score: 'fluent', marks: ['met', 'met'], diagnosis: 'Complete', gradedAt: GRADE, evaluator: 'self', correction: false }]);
  assert.deepEqual(parseAttempt(graded), graded);
});

test('forged answer fields in grade and correctGrade reject without changing frozen A', () => {
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  const before = structuredClone(frozen);
  invalid(() => transitionAttempt(frozen, { ...gradeCommand(), answer: 'B' } as never, GRADE));
  assert.deepEqual(frozen, before);
  const graded = transitionAttempt(frozen, gradeCommand(), GRADE);
  const gradedBefore = structuredClone(graded);
  invalid(() => transitionAttempt(graded, { ...gradeCommand(), type: 'correctGrade', answer: 'B' } as never, CORRECT));
  assert.deepEqual(graded, gradedBefore);
});

test('frozen answers cannot be changed or refrozen, and open answers cannot be graded', () => {
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  invalid(() => transitionAttempt(frozen, { type: 'saveAnswer', answer: 'B' }, GRADE), 'INVALID_TRANSITION');
  invalid(() => transitionAttempt(frozen, { type: 'freeze' }, GRADE), 'INVALID_TRANSITION');
  invalid(() => transitionAttempt(attempt(), gradeCommand(), GRADE), 'INVALID_TRANSITION');
  invalid(() => transitionAttempt(frozen, { ...gradeCommand(), type: 'correctGrade' }, GRADE), 'INVALID_TRANSITION');
});

test('abandoned attempts cannot save, freeze or grade', () => {
  const abandoned = transitionAttempt(attempt(), { type: 'abandon' }, FREEZE);
  assert.equal(abandoned.status, 'abandoned');
  for (const command of [{ type: 'saveAnswer', answer: 'B' }, { type: 'freeze' }, gradeCommand(), { type: 'abandon' }] as const) {
    invalid(() => transitionAttempt(abandoned, command, GRADE), 'INVALID_TRANSITION');
  }
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  const abandonedFrozen = transitionAttempt(frozen, { type: 'abandon' }, GRADE);
  assert.equal(abandonedFrozen.answerHash, frozen.answerHash);
  assert.equal(abandonedFrozen.frozenAt, FREEZE);
});

test('grade corrections append an event and keep original grade and freeze position', () => {
  const graded = transitionAttempt(transitionAttempt(attempt(), { type: 'freeze' }, FREEZE), gradeCommand(), GRADE);
  const corrected = transitionAttempt(graded, { type: 'correctGrade', score: 'partial', marks: ['met', 'missing'], diagnosis: 'Rechecked' }, CORRECT);
  assert.equal(graded.grades.length, 1);
  assert.equal(corrected.grades.length, 2);
  assert.deepEqual(requiredEntry(corrected.grades, 0), requiredEntry(graded.grades, 0));
  assert.equal(requiredEntry(corrected.grades, 1).correction, true);
  assert.equal(requiredEntry(corrected.grades, 1).gradedAt, CORRECT);
  assert.equal(corrected.frozenAt, FREEZE);
  invalid(() => transitionAttempt(corrected, gradeCommand(), CORRECT), 'INVALID_TRANSITION');
  invalid(() => transitionAttempt(corrected, { type: 'abandon' }, CORRECT), 'INVALID_TRANSITION');
  corrected.snapshot.rubric[0] = 'Mutated';
  requiredEntry(corrected.grades, 0).marks[0] = 'missing';
  assert.equal(requiredEntry(graded.snapshot.rubric, 0), 'Names inputs');
  assert.equal(requiredEntry(requiredEntry(graded.grades, 0).marks, 0), 'met');
});

test('parsers reject forged hashes and contradictory persisted states', () => {
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  invalid(() => parseAttempt({ ...frozen, answer: 'B' }));
  invalid(() => parseAttempt({ ...frozen, answerHash: '0'.repeat(64) }));
  invalid(() => parseAttempt({ ...attempt(), answerHash: frozen.answerHash }));
  invalid(() => parseAttempt({ ...attempt(), frozenAt: FREEZE }));
  invalid(() => parseAttempt({ ...frozen, status: 'graded' }));
  invalid(() => parseAttempt({ ...frozen, grades: [{ score: 'fluent', marks: ['met', 'met'], diagnosis: '', gradedAt: GRADE, evaluator: 'self', correction: true }] }));
});

test('grade validation requires exact marks, enums and event shape', () => {
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  for (const marks of [[], ['met'], ['met', 'met', 'met'], ['bad', 'met']]) {
    invalid(() => transitionAttempt(frozen, { ...gradeCommand(), marks } as never, GRADE));
  }
  invalid(() => parseAttemptCommand({ ...gradeCommand(), evaluator: 'ai' }));
  invalid(() => parseAttemptCommand({ ...gradeCommand(), score: 'pass' }));
  invalid(() => parseAttemptCommand({ type: 'freeze', answer: 'B' }));
  invalid(() => parseAttemptCommand({ type: 'saveAnswer' }));
  invalid(() => parseAttemptCommand({ type: 'other' }));
  const graded = transitionAttempt(frozen, gradeCommand(), GRADE);
  invalid(() => parseAttempt({ ...graded, grades: [{ ...requiredEntry(graded.grades, 0), answer: 'B' }] }));
});

test('supplied clocks are canonical and monotonic and revision overflow rejects', () => {
  invalid(() => transitionAttempt(attempt(), { type: 'freeze' }, 'invalid'));
  invalid(() => transitionAttempt(attempt(), { type: 'freeze' }, '2026-10-25T10:00:00.000Z'));
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  invalid(() => transitionAttempt(frozen, gradeCommand(), OPEN));
  const graded = transitionAttempt(frozen, gradeCommand(), GRADE);
  invalid(() => transitionAttempt(graded, { ...gradeCommand(), type: 'correctGrade' }, FREEZE));
  invalid(() => transitionAttempt({ ...attempt(), revision: Number.MAX_SAFE_INTEGER }, { type: 'freeze' }, FREEZE));
});

test('persisted answers reject isolated UTF-16 high and low surrogates', () => {
  for (const answer of ['\uD800', '\uDC00', 'before\uD801after', 'before\uDFFFafter']) {
    invalid(() => parseAttempt({ ...attempt(), answer }));
  }
});

test('saveAnswer rejects isolated UTF-16 high and low surrogates without changing the answer', () => {
  const original = attempt();
  for (const answer of ['\uD800', '\uDC00', 'before\uD801after', 'before\uDFFFafter']) {
    invalid(() => parseAttemptCommand({ type: 'saveAnswer', answer }));
    invalid(() => transitionAttempt(original, { type: 'saveAnswer', answer }, OPEN));
    assert.equal(original.answer, 'A');
  }
});

test('malformed frozen-answer substitutions reject even when UTF-8 replacement bytes have the same hash', () => {
  const malformedA = '\uD800';
  const malformedB = '\uD801';
  const replacementHash = createHash('sha256').update(malformedA, 'utf8').digest('hex');
  assert.equal(createHash('sha256').update(malformedB, 'utf8').digest('hex'), replacementHash);
  const frozen = transitionAttempt(attempt(), { type: 'freeze' }, FREEZE);
  for (const answer of [malformedA, malformedB]) {
    invalid(() => parseAttempt({ ...frozen, answer, answerHash: replacementHash }));
  }
  invalid(() => transitionAttempt({ ...attempt(), answer: malformedA }, { type: 'freeze' }, FREEZE));
});

test('valid emoji and ordinary Unicode round trip exactly through save, freeze and grading', () => {
  const answer = 'Balance α: 💧 🧪 café';
  const saved = transitionAttempt(attempt(), { type: 'saveAnswer', answer }, OPEN);
  const frozen = transitionAttempt(saved, { type: 'freeze' }, FREEZE);
  const graded = transitionAttempt(frozen, gradeCommand(), GRADE);
  assert.equal(graded.answer, answer);
  assert.equal(parseAttempt(JSON.parse(JSON.stringify(graded))).answer, answer);
  assert.equal(graded.answerHash, createHash('sha256').update(answer, 'utf8').digest('hex'));
});
