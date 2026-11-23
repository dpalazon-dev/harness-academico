import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginInference } from 'learnharness-plugin-api';
import { createAreaService } from '../src/study/areas.ts';
import { createOperations } from '../src/operations.ts';
import { createPracticeService } from '../src/practice/service.ts';
import { createStudyTools } from '../src/tools.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import { NOW, plan, tema, tempStore, unit } from './study-fixtures.ts';

let n = 0;
const newId = () => `id-${++n}`;
const now = () => NOW;
const conversation = (id: string, areaId: string | null) => ({ id, revision: 1, briefing: '', briefedAt: NOW, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId, unitId: null, origen: null });

test('records written before spaces read as belonging to none', t => {
  const store = tempStore(t);
  const { areaId: _u, ...oldUnit } = unit();
  const { areaId: _p, ...oldPlan } = plan();
  fs.writeFileSync(path.join(store.root, 'units', 'u1.json'), JSON.stringify(oldUnit));
  fs.writeFileSync(path.join(store.root, 'plans', 'p1.json'), JSON.stringify(oldPlan));
  const { areaId: _c, ...oldConversation } = conversation('c1', null);
  fs.writeFileSync(path.join(store.root, 'conversations', 'c1.json'), JSON.stringify(oldConversation));
  assert.equal(store.getUnit('u1')!.areaId, null);
  assert.equal(store.getPlan('p1')!.areaId, null);
  assert.equal(store.getConversation('c1')!.areaId, null);
});

test('creating a space makes it active; archiving the active one returns to every space; names are unique', t => {
  const store = tempStore(t);
  const areas = createAreaService(store, now, newId);
  assert.deepEqual(areas.view(), { areas: [], activeAreaId: null });
  const fis = areas.create({ name: 'Física', description: 'Mecánica' });
  assert.equal(areas.activeId(), fis.id);
  assert.throws(() => areas.create({ name: 'física' }), /Ya existe/);
  areas.create({ name: 'Matemáticas' });
  assert.equal(areas.activate({ areaId: fis.id }).activeAreaId, fis.id);
  assert.equal(areas.edit({ id: fis.id, expectedRevision: 1, name: 'Física general' }).name, 'Física general');
  areas.edit({ id: fis.id, expectedRevision: 2, archived: true });
  assert.equal(areas.activeId(), null);
  assert.throws(() => areas.activate({ areaId: fis.id }), /archivado/);
  assert.equal(areas.activate({ areaId: null }).activeAreaId, null);
  assert.deepEqual(areas.view().areas.map(a => a.name), ['Física general', 'Matemáticas']);
});

test('each space has its own plans, units and proposals; «Todos» sees everything', t => {
  const store = tempStore(t);
  const ops = createOperations(store, now, newId);
  const a = ops.createPlan({ goal: 'Dinámica' }, 'fis');
  ops.createPlan({ goal: 'Cálculo' }, 'mat');
  const u = ops.createUnit({ title: 'Newton' }, undefined, undefined, 'fis');
  ops.createUnit({ title: 'Cadena' }, undefined, undefined, 'mat');
  assert.equal(u.areaId, 'fis');
  assert.deepEqual(ops.plans('fis').map(p => p.goal), ['Dinámica']);
  const proposal = ops.proposePlanChange({ planId: a.id, ops: [{ op: 'add', tipo: 'tema', titulo: 'Newton' }], rationale: '' });
  assert.deepEqual(ops.state('fis').units.map(x => x.title), ['Newton']);
  assert.deepEqual(ops.state('fis').proposals.map(p => p.id), [proposal.id]);
  assert.equal(ops.state('mat').proposals.length, 0);
  assert.equal(ops.state().units.length, 2);
  assert.equal(ops.plans().length, 2);
});

test('Hoy, Ruta and Progreso read only the units of the active space', t => {
  const store = tempStore(t);
  store.saveUnit(unit({ id: 'u-fis', title: 'Newton', areaId: 'fis' }), null);
  store.saveUnit(unit({ id: 'u-mat', title: 'Cadena', areaId: 'mat' }), null);
  const practice = createPracticeService(store, { inference: {} as PluginInference, now, newId, timeZone: 'Europe/Madrid', signal: new AbortController().signal });
  assert.deepEqual(practice.overview('fis').map(r => r.title), ['Newton']);
  assert.deepEqual(practice.progress('mat').units.map(r => r.title), ['Cadena']);
  assert.deepEqual(practice.today('fis').queue.map(r => r.title), ['Newton']);
  assert.equal(practice.overview().length, 2);
});

test('moving a plan takes its units; bringing in takes everything without a space, conversations included', t => {
  const store = tempStore(t);
  const areas = createAreaService(store, now, newId);
  store.saveUnit(unit({ id: 'u1' }), null);
  store.saveUnit(unit({ id: 'u2', title: 'Otra' }), null);
  store.savePlan(plan({ elementos: [tema('e1', { unitId: 'u1' }), tema('e2')] }), null);
  const fis = areas.create({ name: 'Física' });
  assert.deepEqual(areas.move({ kind: 'plan', id: 'p1', areaId: fis.id }), { moved: 2 });
  assert.equal(store.getUnit('u1')!.areaId, fis.id);
  assert.equal(store.getUnit('u2')!.areaId, null);
  areas.create({ name: 'Matemáticas' });
  assert.throws(() => areas.move({ kind: 'unidad', id: 'u1', areaId: 'no-existe' }), /no existe/);
  areas.activate({ areaId: fis.id });
  assert.deepEqual(areas.adopt(['chat-viejo']), { moved: 2 });
  assert.equal(store.getUnit('u2')!.areaId, fis.id);
  assert.equal(store.getConversation('chat-viejo')!.areaId, fis.id);
  assert.equal(store.getConversation('chat-viejo')!.briefedAt, null, 'an adopted conversation keeps no briefing');
  areas.activate({ areaId: null });
  assert.throws(() => areas.adopt([]), /Elige primero un espacio/);
});

test('a plan the tutor proposes takes the space of its conversation, else the active one', async t => {
  const store = tempStore(t);
  const areas = createAreaService(store, now, newId);
  const ops = createOperations(store, now, newId);
  const fis = areas.create({ name: 'Física' });
  const mat = areas.create({ name: 'Matemáticas' });
  store.saveConversation(conversation('c-fis', fis.id), null);
  // The active space is Matemáticas, but the conversation was started in Física.
  const tools = createStudyTools(ops, { chatId: 'c-fis', agent: 'teacher' } as never, () => {}, undefined, undefined, () => areas.forChat('c-fis'));
  await tools.find(x => x.name === 'estudio_proponer_plan')!.execute('t1', { goal: 'Dinámica', elementos: [{ tipo: 'tema', titulo: 'Newton' }] } as never, undefined as never);
  assert.equal(store.listPlans().find(p => p.goal === 'Dinámica')!.areaId, fis.id);
  assert.equal(areas.forChat('c-sin-registro'), mat.id);
});

test('a new notebook takes the active space; a source note, the space of its document', t => {
  const store = tempStore(t);
  store.saveDocument({ id: 'd1', revision: 1, title: 'Manual', path: 'C:/m.pdf', status: 'procesando', error: null, startedAt: NOW, finishedAt: null, original: null, doclingSha256: null, estructuraSha256: null, paginas: null, contraste: null, revisar: [], areaId: 'fis' }, null);
  const notebooks = createNotebookService(store, { now, newId, area: () => 'mat' });
  assert.equal(notebooks.create({ title: 'Libre' }).areaId, 'mat');
  assert.equal(notebooks.notePassage({ documentId: 'd1', page: 1, quote: 'Cita' }).areaId, 'fis');
});
