import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyProposal, rejectProposal } from '../src/study/proposals.ts';
import { StudyError } from '../src/study/types.ts';
import { LATER, plan, proposal, tempStore, unit } from './study-fixtures.ts';

const is = (code: string) => (error: unknown) => error instanceof StudyError && error.code === code;

function seeded(t: Parameters<typeof tempStore>[0]) {
  const store = tempStore(t);
  for (const id of ['u1', 'u2', 'u3']) store.saveUnit(unit({ id }), null);
  store.savePlan(plan({ unitIds: ['u2', 'u3'] }), null);
  return store;
}

test('applying a current proposal applies every op and bumps the plan revision by one', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'add', unitId: 'u1', index: 0 }, { op: 'move', unitId: 'u3', index: 1 }, { op: 'remove', unitId: 'u2' }] }), null);
  const result = applyProposal(store, 'q1', LATER);
  assert.deepEqual(result.unitIds, ['u1', 'u3']);
  assert.equal(result.revision, 2);
  assert.equal(store.getProposal('q1')?.status, 'aplicada');
  assert.equal(store.getProposal('q1')?.decidedAt, LATER);
});

test('a proposal on an older plan revision still applies when later changes touched other units', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'add', unitId: 'u1' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'remove', unitId: 'u2' }] }), null);
  applyProposal(store, 'q2', LATER);
  assert.deepEqual(applyProposal(store, 'q1', LATER).unitIds, ['u3', 'u1']);
  assert.equal(store.getProposal('q1')?.status, 'aplicada');
});

test('a proposal whose unit a later applied change already touched becomes stale and leaves the plan untouched', t => {
  const store = seeded(t);
  store.saveUnit(unit({ id: 'u4', title: 'Regla de la cadena' }), null);
  store.saveProposal(proposal({ ops: [{ op: 'move', unitId: 'u3', index: 0 }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'move', unitId: 'u3', index: 0 }, { op: 'add', unitId: 'u4' }] }), null);
  applyProposal(store, 'q2', LATER);
  store.saveProposal(proposal({ id: 'q3', ops: [{ op: 'add', unitId: 'u4' }] }), null);
  assert.throws(() => applyProposal(store, 'q1', LATER), (e: unknown) => is('CONFLICT')(e) && /ya no encaja.*otro cambio del plan ya tocó «Derivada como límite»/.test((e as Error).message));
  assert.equal(store.getProposal('q1')?.status, 'obsoleta');
  assert.throws(() => applyProposal(store, 'q3', LATER), /«Regla de la cadena» ya está en el plan/);
  assert.deepEqual(store.getPlan('p1')?.unitIds, ['u3', 'u2', 'u4']);
});

test('a positional proposal becomes stale once the list changed, even if other units were touched', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'move', unitId: 'u3', index: 0 }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'add', unitId: 'u1', index: 0 }] }), null);
  applyProposal(store, 'q2', LATER);
  assert.throws(() => applyProposal(store, 'q1', LATER), /la posición que proponía para «Derivada como límite» ya no es la misma/);
  assert.deepEqual(store.getPlan('p1')?.unitIds, ['u1', 'u2', 'u3']);
});

test('discarding a stale proposal records it as stale, a current one as rejected', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'remove', unitId: 'u2' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'remove', unitId: 'u2' }] }), null);
  store.saveProposal(proposal({ id: 'q3', ops: [{ op: 'add', unitId: 'u1' }] }), null);
  applyProposal(store, 'q2', LATER);
  assert.equal(rejectProposal(store, 'q1', LATER).status, 'obsoleta');
  assert.equal(rejectProposal(store, 'q3', LATER).status, 'rechazada');
});

test('a proposal the plan records as applied counts as a later change even if marking it failed', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'move', unitId: 'u3', index: 0 }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'move', unitId: 'u3', index: 0 }] }), null);
  store.savePlan(plan({ revision: 2, unitIds: ['u3', 'u2'], lastAppliedProposalId: 'q2' }), 1);
  assert.throws(() => applyProposal(store, 'q1', LATER), /otro cambio del plan ya tocó/);
});

test('one invalid op makes the whole proposal stale without applying any op', t => {
  for (const bad of [
    { op: 'add', unitId: 'ghost' }, { op: 'add', unitId: 'u2' }, { op: 'add', unitId: 'u1', index: 5 },
    { op: 'remove', unitId: 'u1' }, { op: 'move', unitId: 'u2', index: 2 },
  ] as const) {
    const store = seeded(t);
    store.saveProposal(proposal({ ops: [{ op: 'remove', unitId: 'u3' }, bad] }), null);
    assert.throws(() => applyProposal(store, 'q1', LATER), is('CONFLICT'), JSON.stringify(bad));
    assert.deepEqual(store.getPlan('p1')?.unitIds, ['u2', 'u3']);
    assert.equal(store.getProposal('q1')?.status, 'obsoleta');
  }
});

test('a decided proposal cannot be applied or rejected again', t => {
  const store = seeded(t);
  store.saveProposal(proposal(), null);
  applyProposal(store, 'q1', LATER);
  assert.throws(() => applyProposal(store, 'q1', LATER), is('INVALID_TRANSITION'));
  assert.throws(() => rejectProposal(store, 'q1', LATER), is('INVALID_TRANSITION'));
  store.saveProposal(proposal({ id: 'q2', baseRevision: 2, ops: [{ op: 'remove', unitId: 'u1' }] }), null);
  assert.equal(rejectProposal(store, 'q2', LATER).status, 'rechazada');
  assert.deepEqual(store.getPlan('p1')?.unitIds, ['u2', 'u3', 'u1']);
});

test('an archived unit cannot be added; a proposed unit added by an applied proposal becomes active', t => {
  const store = seeded(t);
  store.saveUnit(unit({ id: 'u4', status: 'archivada' }), null);
  store.saveUnit(unit({ id: 'u5', status: 'propuesta' }), null);
  store.saveProposal(proposal({ ops: [{ op: 'add', unitId: 'u4' }] }), null);
  assert.throws(() => applyProposal(store, 'q1', LATER), is('CONFLICT'));
  assert.equal(store.getProposal('q1')?.status, 'obsoleta');
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'add', unitId: 'u5' }] }), null);
  applyProposal(store, 'q2', LATER);
  assert.equal(store.getUnit('u5')?.status, 'activa');
  assert.deepEqual(store.getPlan('p1')?.unitIds, ['u2', 'u3', 'u5']);
});

test('a proposal the plan already records as applied is marked applied, not stale', t => {
  const store = seeded(t);
  store.saveProposal(proposal(), null);
  store.savePlan(plan({ revision: 2, unitIds: ['u2', 'u3', 'u1'], lastAppliedProposalId: 'q1' }), 1);
  const result = applyProposal(store, 'q1', LATER);
  assert.equal(result.revision, 2);
  assert.equal(store.getProposal('q1')?.status, 'aplicada');
});
