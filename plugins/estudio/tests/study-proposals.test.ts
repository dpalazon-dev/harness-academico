import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, applyProposal, describirOp, rejectProposal } from '../src/study/proposals.ts';
import { StudyError } from '../src/study/types.ts';
import { LATER, plan, proposal, tema, tempStore } from './study-fixtures.ts';

const is = (code: string) => (error: unknown) => error instanceof StudyError && error.code === code;
const ids = () => { let n = 0; return () => `n${++n}`; };
const titulos = (store: ReturnType<typeof tempStore>) => store.getPlan('p1')?.elementos.map(e => e.titulo);

function seeded(t: Parameters<typeof tempStore>[0]) {
  const store = tempStore(t);
  store.savePlan(plan({ elementos: [tema('e2', { titulo: 'Derivadas' }), tema('e3', { titulo: 'Integrales' })] }), null);
  return store;
}

test('applying a current proposal applies every op, gives new elements an id and bumps the plan revision by one', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'add', tipo: 'tarea', titulo: 'Leer cap. 1', index: 0 }, { op: 'move', elementoId: 'e3', index: 1 }, { op: 'remove', elementoId: 'e2' }] }), null);
  const result = applyProposal(store, 'q1', LATER, ids());
  assert.deepEqual(result.elementos, [{ id: 'n1', tipo: 'tarea', titulo: 'Leer cap. 1', hecho: false }, tema('e3', { titulo: 'Integrales' })]);
  assert.equal(result.revision, 2);
  assert.equal(store.getProposal('q1')?.status, 'aplicada');
  assert.equal(store.getProposal('q1')?.decidedAt, LATER);
});

test('a proposal on an older plan revision still applies when later changes touched other elements', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'add', tipo: 'hito', titulo: 'Examen', fecha: '2027-01-20' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'remove', elementoId: 'e2' }] }), null);
  applyProposal(store, 'q2', LATER, ids());
  assert.deepEqual(applyProposal(store, 'q1', LATER, ids()).elementos.map(e => [e.titulo, e.fecha]), [['Integrales', undefined], ['Examen', '2027-01-20']]);
});

test('a proposal whose element a later applied change already touched becomes stale and leaves the plan untouched', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'remove', elementoId: 'e3' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'move', elementoId: 'e3', index: 0 }] }), null);
  applyProposal(store, 'q2', LATER, ids());
  assert.throws(() => applyProposal(store, 'q1', LATER, ids()), (e: unknown) => is('CONFLICT')(e) && /ya no encaja.*otro cambio del plan ya tocó el tema «Integrales»/.test((e as Error).message));
  assert.equal(store.getProposal('q1')?.status, 'obsoleta');
  assert.deepEqual(titulos(store), ['Integrales', 'Derivadas']);
});

test('a positional proposal becomes stale once the list changed, also by direct edits', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'move', elementoId: 'e3', index: 0 }] }), null);
  const p = store.getPlan('p1')!;
  store.savePlan({ ...p, revision: 2, elementos: [...p.elementos, tema('e4')] }, 1);
  assert.throws(() => applyProposal(store, 'q1', LATER, ids()), /la posición que proponía ya no es la misma/);
});

test('discarding a stale proposal records it as stale, a current one as rejected', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'remove', elementoId: 'e2' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'remove', elementoId: 'e2' }] }), null);
  store.saveProposal(proposal({ id: 'q3' }), null);
  applyProposal(store, 'q2', LATER, ids());
  assert.equal(rejectProposal(store, 'q1', LATER).status, 'obsoleta');
  assert.equal(rejectProposal(store, 'q3', LATER).status, 'rechazada');
});

test('a proposal on a plan that is no longer active is stale', t => {
  const store = seeded(t);
  store.saveProposal(proposal(), null);
  store.savePlan({ ...store.getPlan('p1')!, revision: 2, estado: 'archivado' }, 1);
  assert.throws(() => applyProposal(store, 'q1', LATER, ids()), /el plan está archivado/);
  assert.equal(store.getProposal('q1')?.status, 'obsoleta');
});

test('a proposal the plan records as applied counts as a later change even if marking it failed', t => {
  const store = seeded(t);
  store.saveProposal(proposal({ ops: [{ op: 'remove', elementoId: 'e3' }] }), null);
  store.saveProposal(proposal({ id: 'q2', ops: [{ op: 'move', elementoId: 'e3', index: 0 }] }), null);
  store.savePlan(plan({ revision: 2, elementos: [tema('e3'), tema('e2')], lastAppliedProposalId: 'q2' }), 1);
  assert.throws(() => applyProposal(store, 'q1', LATER, ids()), /otro cambio del plan ya tocó/);
});

test('one invalid op makes the whole proposal stale without applying any op', t => {
  for (const bad of [
    { op: 'remove', elementoId: 'ghost' }, { op: 'add', tipo: 'tema', titulo: 'X', index: 5 }, { op: 'move', elementoId: 'e2', index: 2 },
  ] as const) {
    const store = seeded(t);
    store.saveProposal(proposal({ ops: [{ op: 'remove', elementoId: 'e3' }, bad] }), null);
    assert.throws(() => applyProposal(store, 'q1', LATER, ids()), is('CONFLICT'), JSON.stringify(bad));
    assert.deepEqual(titulos(store), ['Derivadas', 'Integrales']);
    assert.equal(store.getProposal('q1')?.status, 'obsoleta');
  }
});

test('a decided proposal cannot be applied or rejected again', t => {
  const store = seeded(t);
  store.saveProposal(proposal(), null);
  applyProposal(store, 'q1', LATER, ids());
  assert.throws(() => applyProposal(store, 'q1', LATER, ids()), is('INVALID_TRANSITION'));
  assert.throws(() => rejectProposal(store, 'q1', LATER), is('INVALID_TRANSITION'));
});

test('a proposal the plan already records as applied is marked applied, not stale', t => {
  const store = seeded(t);
  store.saveProposal(proposal(), null);
  store.savePlan(plan({ revision: 2, elementos: [tema('e2'), tema('e3'), tema('n1')], lastAppliedProposalId: 'q1' }), 1);
  const result = applyProposal(store, 'q1', LATER, ids());
  assert.equal(result.revision, 2);
  assert.equal(store.getProposal('q1')?.status, 'aplicada');
});

test('direct edits rename, mark done, date a hito and clear its date; the input list is not mutated', () => {
  const start = [tema('e1', { unitId: 'u1' }), { id: 'h1', tipo: 'hito' as const, titulo: 'Parcial', hecho: false }];
  const next = applyOps(start, [
    { op: 'edit', elementoId: 'h1', titulo: 'Examen parcial', fecha: '2027-02-01', hecho: true },
    { op: 'remove', elementoId: 'e1' },
  ], ids());
  assert.deepEqual(next, [{ id: 'h1', tipo: 'hito', titulo: 'Examen parcial', hecho: true, fecha: '2027-02-01' }]);
  assert.deepEqual(applyOps(next, [{ op: 'edit', elementoId: 'h1', fecha: null }], ids())[0], { id: 'h1', tipo: 'hito', titulo: 'Examen parcial', hecho: true });
  assert.throws(() => applyOps(start, [{ op: 'edit', elementoId: 'e1', fecha: '2027-02-01' }], ids()), /Solo un hito lleva fecha/);
  assert.deepEqual(start[0], tema('e1', { unitId: 'u1' }));
});

test('describirOp words a change against the plan', () => {
  const elementos = [tema('e1', { titulo: 'Derivadas' })];
  assert.equal(describirOp({ op: 'add', tipo: 'hito', titulo: 'Examen', fecha: '2027-01-20', index: 0 }, elementos), 'Añadir el hito «Examen» (2027-01-20) en la posición 1');
  assert.equal(describirOp({ op: 'remove', elementoId: 'e1' }, elementos), 'Quitar el tema «Derivadas»');
  assert.equal(describirOp({ op: 'move', elementoId: 'zz', index: 2 }, elementos), 'Mover un elemento que ya no está en el plan a la posición 3');
});
