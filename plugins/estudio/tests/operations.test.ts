import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperations } from '../src/operations.ts';
import { NOW, tempStore, unit } from './study-fixtures.ts';

test('a refused plan proposal creates no plan, even when it carries a goal', t => {
  const store = tempStore(t);
  let n = 0;
  const ops = createOperations(store, () => NOW, () => `id${++n}`);
  assert.throws(() => ops.proposePlanChange({ goal: 'Cálculo', ops: [{ op: 'add', unitId: 'ghost' }], rationale: '' }, 'tutor'), /no existe/);
  store.saveUnit(unit({ id: 'old', status: 'archivada' }), null);
  assert.throws(() => ops.proposePlanChange({ goal: 'Cálculo', ops: [{ op: 'add', unitId: 'old' }], rationale: '' }, 'tutor'), /está archivada/);
  assert.deepEqual(store.listPlans(), []);
});

test('adding a source is idempotent and guarded by the unit revision', t => {
  const store = tempStore(t);
  const ops = createOperations(store, () => NOW);
  store.saveUnit(unit({ id: 'u1' }), null);
  const once = ops.addSource('u1', 1, { path: 'documento:d1', locator: '2' });
  assert.equal(once.revision, 2);
  assert.equal(ops.addSource('u1', 2, { path: 'documento:d1', locator: '2' }).revision, 2);
  assert.throws(() => ops.addSource('u1', 1, { path: 'documento:d2' }), /cambió mientras tanto.*revisión 1 y está en la 2/);
  assert.throws(() => ops.addSource('u1', 2, { path: 'documento:d2', page: 3 }), /not allowed/);
});

/** The panel confirms a proposed unit by proposing and applying its addition to the plan (components/estudio/llamar.ts). */
function confirmInPanel(ops: ReturnType<typeof createOperations>, planId: string, unitId: string) {
  ops.applyProposal({ id: ops.proposePlanChange({ planId, ops: [{ op: 'add', unitId }] }, 'david').id });
}

test('confirming a proposed unit leaves a pending tutor change on other units applicable', t => {
  const store = tempStore(t);
  let n = 0;
  const ops = createOperations(store, () => NOW, () => `id${++n}`);
  for (const id of ['u1', 'u2']) store.saveUnit(unit({ id }), null);
  store.saveUnit(unit({ id: 'nueva', status: 'propuesta' }), null);
  const plan = ops.createPlan({ goal: 'Cálculo' });
  confirmInPanel(ops, plan.id, 'u1');
  const tutor = ops.proposePlanChange({ planId: plan.id, ops: [{ op: 'add', unitId: 'u2' }], rationale: 'Base' }, 'tutor');
  confirmInPanel(ops, plan.id, 'nueva');
  assert.deepEqual(ops.applyProposal({ id: tutor.id }).unitIds, ['u1', 'nueva', 'u2']);
  assert.equal(store.getProposal(tutor.id)?.status, 'aplicada');
});
