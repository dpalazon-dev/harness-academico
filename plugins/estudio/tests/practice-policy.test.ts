import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessFromCue, dailyQueue, regulate, type TraceEntry, type UnitRegulation } from '../src/practice/policy.ts';
import { answerHash } from '../src/practice/schema.ts';
import type { FailureType, PracticeAttempt, TaskKind } from '../src/practice/types.ts';
import type { StudyUnit } from '../src/study/types.ts';
import { MODEL } from './practice-fixtures.ts';
import { unit } from './study-fixtures.ts';

const TZ = 'Europe/Madrid';
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number, hour = 10) => new Date(Date.UTC(2026, 10, 1 + days, hour)).toISOString();

let seq = 0;
function graded(day: number, opts: { cue?: number; fidelity?: 0 | 1 | 2 | 3; use?: 0 | 1 | 2 | null; failure?: FailureType | null; kind?: TaskKind; taskId?: string; confidence?: number; judged?: 0 | 1 | 2 | 3 } = {}): PracticeAttempt {
  const id = `a${++seq}`;
  const kind = opts.kind ?? 'libre';
  return {
    id, revision: 4, unitId: 'u1', taskId: opts.taskId ?? `t-${id}`, taskKind: kind, openedAt: at(day), confidence: opts.confidence ?? 50,
    cueLevel: opts.cue ?? 0, cueLevelAtFreeze: opts.cue ?? 0, answer: 'x', answerHash: answerHash('x'), frozenAt: at(day, 11), status: 'graded',
    contextLabel: kind,
    judgments: opts.judged === undefined ? [] : [{ fidelity: opts.judged, failureType: null, rationale: '', judgedAt: at(day, 11), model: MODEL }],
    grades: [{ fidelity: opts.fidelity ?? 3, use: kind === 'aplicada' ? (opts.use ?? 2) : null, failureType: opts.failure ?? null, gradedAt: at(day, 11), correction: false }],
  };
}

const reconstruct = (o: Partial<StudyUnit> = {}) => unit({ createdAt: at(0), policy: 'reconstruir', ...o });

test('cue levels map to access', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(accessFromCue), [3, 2, 2, 1, 1, 1, 0]);
});

test('archived units and localizar units stay out of the queue', () => {
  assert.equal(regulate(reconstruct({ policy: 'localizar' }), [], [], at(0), TZ).mode, 'fuera');
  assert.equal(regulate(reconstruct({ status: 'archivada' }), [], [], at(0), TZ).mode, 'fuera');
});

test('a new unit is due today with the default task of its policy', () => {
  const r = regulate(unit({ policy: 'recordar' }), [], [], at(3), TZ);
  assert.equal(r.dueDate, '2026-11-04');
  assert.equal(r.nextTaskKind, 'guiada');
  assert.equal(regulate(unit({ policy: 'ejecutar' }), [], [], at(3), TZ).nextTaskKind, 'aplicada');
});

test('full access and fidelity climb the interval ladder', () => {
  const attempts = [graded(0), graded(2), graded(9)];
  const r = regulate(reconstruct(), attempts, [], at(9), TZ);
  assert.equal(r.step, 2);
  assert.equal(r.dueDate, '2026-12-01');
  assert.equal(r.eligibleCount, 3);
});

test('low access sends the unit back to one day and the first step', () => {
  const r = regulate(reconstruct(), [graded(0), graded(2), graded(9, { cue: 4, fidelity: 2 })], [], at(9), TZ);
  assert.equal(r.step, -1);
  assert.equal(r.dueDate, '2026-11-11');
});

test('partial fidelity keeps the current interval', () => {
  const r = regulate(reconstruct(), [graded(0), graded(2, { fidelity: 2 })], [], at(2), TZ);
  assert.equal(r.step, 0);
  assert.equal(r.dueDate, '2026-11-05');
});

test('the failure type chooses the next task', () => {
  const r = regulate(reconstruct(), [graded(0, { fidelity: 1, failure: 'discriminacion' })], [], at(0), TZ);
  assert.equal(r.nextTaskKind, 'comparacion');
  assert.equal(r.lastFailure, 'discriminacion');
});

test('recalling without an applied case yet leads to an applied case', () => {
  assert.equal(regulate(reconstruct(), [graded(0)], [], at(0), TZ).nextTaskKind, 'aplicada');
  assert.equal(regulate(unit({ createdAt: at(0), policy: 'recordar' }), [graded(0)], [], at(0), TZ).nextTaskKind, 'guiada');
});

test('autonomous use in two distinct cases after the 21-day step moves to maintenance at 90 days', () => {
  const attempts = [graded(0), graded(2, { kind: 'aplicada' }), graded(9, { kind: 'aplicada' })];
  const r = regulate(reconstruct(), attempts, [], at(9), TZ);
  assert.equal(r.mode, 'mantenimiento');
  assert.equal(r.dueDate, '2027-02-08');
  const sameCase = [graded(0), graded(2, { kind: 'aplicada', taskId: 'c' }), graded(9, { kind: 'aplicada', taskId: 'c' })];
  assert.equal(regulate(reconstruct(), sameCase, [], at(9), TZ).mode, 'cola');
});

test('an attempt within 24 hours of an exposure is practice: it earns no interval', () => {
  const exposures = [at(2, 9)];
  const r = regulate(reconstruct(), [graded(0), graded(2)], exposures, at(2), TZ);
  assert.equal(r.eligibleCount, 1);
  assert.equal(r.step, 0);
  const failed = regulate(reconstruct(), [graded(0), graded(2, { fidelity: 1 })], exposures, at(2), TZ);
  assert.equal(failed.dueDate, '2026-11-03', 'practice never pushes a review later');
  assert.ok(Date.parse(at(2)) - Date.parse(exposures[0]!) < DAY);
});

test('a model judgment two points away from David\'s flags verification and brings the review forward', () => {
  const r = regulate(reconstruct(), [graded(0, { judged: 1 })], [], at(0), TZ);
  assert.equal(r.needsVerification, true);
  assert.equal(r.dueDate, '2026-11-02');
  assert.equal(regulate(reconstruct(), [graded(0, { judged: 2 })], [], at(0), TZ).needsVerification, false);
});

test('Brier score uses prior confidence against full access and fidelity', () => {
  const r = regulate(reconstruct(), [graded(0, { confidence: 80 }), graded(2, { confidence: 80, fidelity: 1 })], [], at(2), TZ);
  assert.equal(r.brier, ((0.8 - 1) ** 2 + 0.8 ** 2) / 2);
});

test('the daily queue keeps due units, alternates oldest and newest and respects the cap', () => {
  const reg = (unitId: string, since: string, dueDate: string | null, mode: UnitRegulation['mode'] = 'cola'): UnitRegulation =>
    ({ unitId, since, mode, step: 0, dueDate, nextTaskKind: 'libre', needsVerification: false, eligibleCount: 0, lastFailure: null, brier: null });
  const all = [reg('a', at(0), '2026-11-05'), reg('b', at(1), '2026-11-05'), reg('c', at(2), '2026-11-05'), reg('d', at(3), '2026-11-06'), reg('e', at(4), '2026-11-01', 'fuera')];
  assert.deepEqual(dailyQueue(all, '2026-11-05').map(r => r.unitId), ['a', 'c', 'b']);
  assert.deepEqual(dailyQueue(all, '2026-11-05', 2).map(r => r.unitId), ['a', 'c']);
});

test('an exposure between opening and freezing makes the attempt practice', () => {
  const during = [new Date(Date.parse(at(2)) + 30 * 60 * 1000).toISOString()];
  const r = regulate(reconstruct(), [graded(0), graded(2)], during, at(2), TZ);
  assert.equal(r.eligibleCount, 1);
});

test('use 0 in a later applied case brings the applied case back, even after an earlier use 2', () => {
  const r = regulate(reconstruct(), [graded(0, { kind: 'aplicada', use: 2 }), graded(2, { kind: 'aplicada', use: 0 })], [], at(2), TZ);
  assert.equal(r.nextTaskKind, 'aplicada');
});

test('a failed review during maintenance returns the unit to the queue', () => {
  const attempts = [graded(0), graded(2, { kind: 'aplicada' }), graded(9, { kind: 'aplicada' }), graded(99, { fidelity: 0, failure: 'precision' })];
  const r = regulate(reconstruct(), attempts, [], at(99), TZ);
  assert.equal(r.mode, 'cola');
  assert.equal(r.nextTaskKind, 'libre');
});

test('failed practice does not raise the verification flag, which is reserved for disputed judgments', () => {
  assert.equal(regulate(reconstruct(), [graded(0), graded(2, { fidelity: 1 })], [at(2, 9)], at(2), TZ).needsVerification, false);
});

test('the trace says what the regulator did with each attempt, and it matches the regulation', () => {
  const trace: TraceEntry[] = [];
  const exposures = [at(9, 2)];
  const r = regulate(reconstruct(), [graded(0), graded(2, { fidelity: 2 }), graded(5, { cue: 4, fidelity: 2 }), graded(9, { fidelity: 1 }), graded(12, { judged: 0 })], exposures, at(12), TZ, trace);
  assert.deepEqual(trace.map(t => [t.day, t.eligible, t.effect, t.days]), [
    ['2026-11-01', true, 'intervalo', 2],
    ['2026-11-03', true, 'repetir', 2],
    ['2026-11-06', true, 'reaprender', 1],
    ['2026-11-10', false, 'practica', 1],
    ['2026-11-13', true, 'verificar', 1],
  ]);
  assert.equal(trace.filter(t => t.eligible).length, r.eligibleCount);
  assert.equal(r.dueDate, '2026-11-14');
});
