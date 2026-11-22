import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAttempt, parseTask } from '../src/practice/schema.ts';
import { StudyError } from '../src/study/types.ts';
import { attempt, frozen, task } from './practice-fixtures.ts';
import { tempStore } from './study-fixtures.ts';

const is = (code: string) => (error: unknown) => error instanceof StudyError && error.code === code;

test('valid tasks and attempts round-trip unchanged', () => {
  assert.deepEqual(parseTask(task()), task());
  assert.deepEqual(parseAttempt(attempt()), attempt());
  assert.deepEqual(parseAttempt(frozen()), frozen());
});

test('unknown fields, wrong cue counts and out-of-range levels are rejected', () => {
  assert.throws(() => parseTask({ ...task(), extra: 1 }), is('INVALID_INPUT'));
  assert.throws(() => parseTask(task({ cues: ['a', 'b'] })), is('INVALID_INPUT'));
  assert.throws(() => parseTask(task({ rubric: [] })), is('INVALID_INPUT'));
  assert.throws(() => parseAttempt(attempt({ cueLevel: 7 })), is('INVALID_INPUT'));
  assert.throws(() => parseAttempt(attempt({ confidence: 101 })), is('INVALID_INPUT'));
  assert.throws(() => parseAttempt(attempt({ taskKind: 'otra' as never })), is('INVALID_INPUT'));
});

test('a frozen answer that does not match its hash is corrupt data', () => {
  assert.throws(() => parseAttempt({ ...frozen(), answer: 'edited later' }), is('CORRUPT_DATA'));
});

test('status and freeze fields must agree', () => {
  assert.throws(() => parseAttempt(attempt({ status: 'frozen' })), is('INVALID_INPUT'));
  assert.throws(() => parseAttempt(frozen('x', { status: 'graded' })), is('INVALID_INPUT'));
});

test('the store saves and lists tasks and attempts by unit', t => {
  const store = tempStore(t);
  store.saveTask(task(), null);
  store.saveTask(task({ id: 't2', unitId: 'u2' }), null);
  store.saveAttempt(attempt(), null);
  assert.deepEqual(store.listTasks('u1').map(x => x.id), ['t1']);
  assert.deepEqual(store.listAttempts('u1').map(x => x.id), ['a1']);
  assert.deepEqual(store.listAttempts('u2'), []);
  store.saveExposures({ id: 'u1', revision: 1, instants: ['2026-11-11T10:00:00.000Z'] }, null);
  assert.deepEqual(store.getExposures('u1')?.instants, ['2026-11-11T10:00:00.000Z']);
});
