import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createOperations } from '../src/operations.ts';
import { NOW, LATER, plan, tema, tempStore, unit } from './study-fixtures.ts';

function setup(t: Parameters<typeof tempStore>[0], clock = () => NOW) {
  const store = tempStore(t);
  let n = 0;
  return { store, ops: createOperations(store, clock, () => `id${++n}`) };
}

test('the tutor drafts a whole plan in one call: proposed, with its elements and no units', t => {
  const { store, ops } = setup(t);
  const p = ops.proposePlan({ goal: 'Aprender ML', elementos: [
    { tipo: 'tema', titulo: 'Regresión lineal' }, { tipo: 'tarea', titulo: 'Leer cap. 3' }, { tipo: 'hito', titulo: 'Examen', fecha: '2027-01-20' },
  ] }, 'chat1', 'esp');
  assert.equal(p.estado, 'propuesto');
  assert.equal(p.origen, 'tutor');
  assert.equal(p.chatId, 'chat1');
  assert.equal(p.areaId, 'esp');
  assert.deepEqual(p.elementos.map(e => [e.tipo, e.titulo, e.hecho, e.fecha]), [['tema', 'Regresión lineal', false, undefined], ['tarea', 'Leer cap. 3', false, undefined], ['hito', 'Examen', false, '2027-01-20']]);
  assert.equal(new Set(p.elementos.map(e => e.id)).size, 3);
  assert.deepEqual(store.listUnits(), []);
  assert.throws(() => ops.proposePlan({ goal: 'X', elementos: [] }, 'chat1'), /non-empty/);
  assert.throws(() => ops.proposePlan({ goal: 'X', elementos: [{ tipo: 'tarea', titulo: 'Y', fecha: '2027-01-01' }] }, 'chat1'), /only allowed on a hito/);
});

test('a proposed plan is accepted or discarded whole; discarding moves it to the bin', t => {
  const { store, ops } = setup(t);
  const a = ops.proposePlan({ goal: 'A', elementos: [{ tipo: 'tema', titulo: 'T' }] }, 'c');
  const b = ops.proposePlan({ goal: 'B', elementos: [{ tipo: 'tema', titulo: 'T' }] }, 'c');
  assert.throws(() => ops.editPlan({ id: a.id, expectedRevision: 1, estado: 'archivado' }), /Acepta o descarta/);
  assert.equal(ops.acceptPlan({ id: a.id, expectedRevision: 1 }).estado, 'activo');
  assert.throws(() => ops.acceptPlan({ id: a.id, expectedRevision: 2 }), /ya no está propuesto/);
  assert.throws(() => ops.discardPlan({ id: a.id, expectedRevision: 2 }), /Solo se descarta un plan propuesto/);
  ops.discardPlan({ id: b.id, expectedRevision: 1 });
  assert.equal(store.getPlan(b.id), null);
  assert.equal(fs.readdirSync(path.join(store.root, 'plans', '.papelera')).length, 1);
});

test('a space can hold several plans; archived plans are left out and the latest updated comes first', t => {
  const { ops } = setup(t);
  const a = ops.createPlan({ goal: 'Dinámica' }, 'fis');
  const b = ops.createPlan({ goal: 'Óptica' }, 'fis');
  ops.createPlan({ goal: 'Cálculo' }, 'mat');
  assert.deepEqual(ops.plans('fis').map(p => p.goal).sort(), ['Dinámica', 'Óptica']);
  assert.equal(a.estado, 'activo');
  ops.editPlan({ id: b.id, expectedRevision: 1, estado: 'archivado' });
  assert.deepEqual(ops.plans('fis').map(p => p.id), [a.id]);
  assert.equal(ops.plans().length, 2);
  assert.equal(ops.editPlan({ id: a.id, expectedRevision: 1, goal: '  Dinámica clásica ' }).goal, 'Dinámica clásica');
  assert.throws(() => ops.editPlan({ id: a.id, expectedRevision: 1, goal: 'X' }), /cambió mientras tanto/);
});

test("David's edits apply at once, guarded by the plan revision", t => {
  const { ops } = setup(t);
  const p = ops.createPlan({ goal: 'ML' });
  const one = ops.changePlan({ id: p.id, expectedRevision: 1, ops: [
    { op: 'add', tipo: 'tema', titulo: 'Árboles' }, { op: 'add', tipo: 'hito', titulo: 'Parcial', fecha: '2027-02-01' },
  ] });
  assert.equal(one.revision, 2);
  const [arboles, parcial] = one.elementos;
  const two = ops.changePlan({ id: p.id, expectedRevision: 2, ops: [
    { op: 'edit', elementoId: arboles!.id, hecho: true, titulo: 'Árboles de decisión' }, { op: 'move', elementoId: parcial!.id, index: 0 },
  ] });
  assert.deepEqual(two.elementos.map(e => [e.titulo, e.hecho]), [['Parcial', false], ['Árboles de decisión', true]]);
  assert.throws(() => ops.changePlan({ id: p.id, expectedRevision: 2, ops: [{ op: 'remove', elementoId: parcial!.id }] }), /cambió mientras tanto/);
  ops.editPlan({ id: p.id, expectedRevision: 3, estado: 'archivado' });
  assert.throws(() => ops.changePlan({ id: p.id, expectedRevision: 4, ops: [{ op: 'remove', elementoId: parcial!.id }] }), /archivado/);
});

test('working on a tema creates an active unit with its title in the plan space and links it once', t => {
  const { store, ops } = setup(t);
  store.savePlan(plan({ areaId: 'esp', elementos: [tema('e1', { titulo: 'Regresión' }), { id: 'e2', tipo: 'tarea', titulo: 'Leer', hecho: false }] }), null);
  const u = ops.workOnTema({ planId: 'p1', elementoId: 'e1' });
  assert.deepEqual([u.title, u.status, u.areaId, u.capability, u.criterion], ['Regresión', 'activa', 'esp', '', '']);
  assert.equal(store.getPlan('p1')!.elementos[0]!.unitId, u.id);
  assert.equal(ops.workOnTema({ planId: 'p1', elementoId: 'e1' }).id, u.id, 'a tema with a unit returns it');
  assert.equal(store.listUnits().length, 1);
  assert.equal(ops.planOfUnit(u.id)!.id, 'p1');
  assert.throws(() => ops.workOnTema({ planId: 'p1', elementoId: 'e2' }), /Solo un tema/);
  // Removing the tema leaves the unit without a plan.
  ops.changePlan({ id: 'p1', expectedRevision: 2, ops: [{ op: 'remove', elementoId: 'e1' }] });
  assert.equal(ops.planOfUnit(u.id), null);
  assert.equal(store.getUnit(u.id)!.status, 'activa');
});

test('a tema of a proposed plan cannot be worked on, and the tutor cannot propose changes to it', t => {
  const { ops } = setup(t);
  const p = ops.proposePlan({ goal: 'ML', elementos: [{ tipo: 'tema', titulo: 'Regresión' }] }, 'c');
  assert.throws(() => ops.workOnTema({ planId: p.id, elementoId: p.elementos[0]!.id }), /Acepta primero/);
  assert.throws(() => ops.proposePlanChange({ planId: p.id, ops: [{ op: 'add', tipo: 'tema', titulo: 'X' }], rationale: '' }), /still proposed/);
  ops.acceptPlan({ id: p.id, expectedRevision: 1 });
  assert.throws(() => ops.proposePlanChange({ planId: p.id, ops: [{ op: 'remove', elementoId: 'ghost' }], rationale: '' }), /no está en el plan/);
  const change = ops.proposePlanChange({ planId: p.id, ops: [{ op: 'add', tipo: 'tarea', titulo: 'Ejercicios' }], rationale: 'Práctica' });
  assert.equal(change.author, 'tutor');
  assert.deepEqual(ops.applyProposal({ id: change.id }).elementos.map(e => e.titulo), ['Regresión', 'Ejercicios']);
});

test("the tutor's capability and criterion wait on the unit until David accepts or discards them", t => {
  const { store, ops } = setup(t, () => LATER);
  store.saveUnit(unit({ id: 'u1', capability: '', criterion: '' }), null);
  const suggested = ops.suggestCapability('u1', { capability: 'Ajustar una recta', criterion: 'Sin mirar' }, 'chat1');
  assert.deepEqual(suggested.sugerencia, { capability: 'Ajustar una recta', criterion: 'Sin mirar', chatId: 'chat1', createdAt: LATER });
  assert.equal(suggested.capability, '');
  const accepted = ops.acceptSuggestion({ id: 'u1', expectedRevision: 2 });
  assert.deepEqual([accepted.capability, accepted.criterion, accepted.sugerencia], ['Ajustar una recta', 'Sin mirar', undefined]);
  assert.throws(() => ops.acceptSuggestion({ id: 'u1', expectedRevision: 3 }), /ninguna sugerencia/);
  ops.suggestCapability('u1', { capability: 'Otra', criterion: 'Otro' }, 'chat1');
  const discarded = ops.discardSuggestion({ id: 'u1', expectedRevision: 4 });
  assert.deepEqual([discarded.capability, discarded.sugerencia], ['Ajustar una recta', undefined]);
  assert.throws(() => ops.suggestCapability('u1', { capability: '', criterion: 'x' }, 'c'), /must not be empty/);
});

test('adding a source is idempotent and guarded by the unit revision', t => {
  const { store, ops } = setup(t);
  store.saveUnit(unit({ id: 'u1' }), null);
  const once = ops.addSource('u1', 1, { path: 'documento:d1', locator: '2' });
  assert.equal(once.revision, 2);
  assert.equal(ops.addSource('u1', 2, { path: 'documento:d1', locator: '2' }).revision, 2);
  assert.throws(() => ops.addSource('u1', 1, { path: 'documento:d2' }), /cambió mientras tanto.*revisión 1 y está en la 2/);
  assert.throws(() => ops.addSource('u1', 2, { path: 'documento:d2', page: 3 }), /not allowed/);
});
