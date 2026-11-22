import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abandon, addJudgment, freeze, grade, openSource, publicAttempt, revealCue, saveAnswer } from '../src/practice/attempts.ts';
import { answerHash } from '../src/practice/schema.ts';
import { StudyError } from '../src/study/types.ts';
import { attempt, MODEL, task } from './practice-fixtures.ts';
import { LATER } from './study-fixtures.ts';

const transition = (error: unknown) => error instanceof StudyError && error.code === 'INVALID_TRANSITION';

test('cues rise one at a time up to five; the source jumps to six', () => {
  let a = attempt();
  for (let i = 1; i <= 5; i++) { a = revealCue(a); assert.equal(a.cueLevel, i); }
  assert.throws(() => revealCue(a), transition);
  assert.equal(openSource(attempt({ cueLevel: 2 })).cueLevel, 6);
});

test('freezing fixes the answer, its hash and the cue level reached', () => {
  const a = freeze(saveAnswer(revealCue(attempt()), 'mi respuesta'), LATER);
  assert.equal(a.status, 'frozen');
  assert.equal(a.answerHash, answerHash('mi respuesta'));
  assert.equal(a.cueLevelAtFreeze, 1);
  assert.equal(a.frozenAt, LATER);
  assert.throws(() => saveAnswer(a, 'otra'), transition);
  assert.throws(() => revealCue(a), transition);
});

test('opening the source after freezing does not change the measured cue level', () => {
  assert.throws(() => openSource(freeze(attempt(), LATER)), transition);
});

test('before freezing only the prompt and requested cues leave the backend', () => {
  const view = publicAttempt(revealCue(revealCue(attempt())), task());
  assert.equal(view.reference, null);
  assert.equal(view.rubric, null);
  assert.deepEqual(view.cues, task().cues.slice(0, 2));
  assert.equal(JSON.stringify(view).includes(task().reference), false);
  assert.equal(publicAttempt(openSource(attempt()), task()).cues.length, 5);
  const after = publicAttempt(freeze(attempt(), LATER), task());
  assert.equal(after.reference, task().reference);
  assert.deepEqual(after.rubric, task().rubric);
});

test('a second self-grade is kept as a correction; use is required only for applied cases', () => {
  const f = freeze(attempt(), LATER);
  const g1 = grade(f, { fidelity: 2, use: null, failureType: 'precision' }, LATER);
  const g2 = grade(g1, { fidelity: 3, use: null, failureType: null }, LATER);
  assert.deepEqual(g2.grades.map(g => [g.fidelity, g.correction]), [[2, false], [3, true]]);
  assert.throws(() => grade(f, { fidelity: 2, use: 1, failureType: null }, LATER), /Only applied/);
  const applied = freeze(attempt({ taskKind: 'aplicada' }), LATER);
  assert.throws(() => grade(applied, { fidelity: 2, use: null, failureType: null }, LATER), /use rating/);
  assert.equal(grade(applied, { fidelity: 2, use: 1, failureType: null }, LATER).grades[0]?.use, 1);
});

test('model judgments are appended after freezing only; abandoned attempts accept nothing', () => {
  const judgment = { fidelity: 2 as const, failureType: null, rationale: 'r', judgedAt: LATER, model: MODEL };
  assert.throws(() => addJudgment(attempt(), judgment), transition);
  assert.equal(addJudgment(freeze(attempt(), LATER), judgment).judgments.length, 1);
  const dropped = abandon(attempt());
  assert.throws(() => grade(dropped, { fidelity: 1, use: null, failureType: null }, LATER), transition);
  assert.throws(() => abandon(freeze(attempt(), LATER)), transition);
  assert.throws(() => abandon(grade(freeze(attempt(), LATER), { fidelity: 1, use: null, failureType: null }, LATER)), transition);
});
