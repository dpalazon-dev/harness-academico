/**
 * La búsqueda de ⌘K (ticket 08): sobre el índice que ya existe, resultados agrupados por tipo (conocimiento,
 * documento, nota, conversación) con su destino, del espacio activo. Primero la operación con el índice real sobre
 * registros, un documento incorporado, notas y conversaciones; después, llamada por nombre con el plugin activado.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';
import { createKbSearch } from '../src/kb/corpus.ts';
import { createPaleta, type BusquedaPaleta } from '../src/paleta.ts';
import type { StoredRecord } from '../src/kb/repo.ts';
import type { SearchDoc } from '../src/kb/search.ts';
import { openStudyStore, type StudyStore } from '../src/study/store.ts';
import { ORIGINAL_SHA, tempAlmacen } from './documents-fixtures.ts';

const AT = '2026-11-13T10:00:00.000Z';

function tempStore(t: TestContext): StudyStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-paleta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return openStudyStore(root);
}

function documento(store: StudyStore, id: string, areaId: string | null, estructuraSha: string) {
  store.saveDocument({
    id, revision: 1, title: `Paper ${id}`, path: `C:/${id}.pdf`, status: 'listo', error: null, startedAt: AT, finishedAt: AT,
    original: { sha256: ORIGINAL_SHA, bytes: 10 }, doclingSha256: null, estructuraSha256: estructuraSha, paginas: 2, contraste: null, revisar: [], areaId,
  }, null);
}

function cuaderno(store: StudyStore, id: string, areaId: string | null, links: { unitId?: string; documentId?: string } = {}) {
  store.saveNotebook({ id, revision: 1, title: `Cuaderno ${id}`, kind: 'libre', unitId: links.unitId ?? null, documentId: links.documentId ?? null, blocks: [], createdAt: AT, updatedAt: AT, areaId }, null);
}

const registro = (header: Record<string, unknown>): StoredRecord => ({ path: `${header.id}.md`, header, body: '' });
const nota = (id: string, text: string): SearchDoc => ({ id: `cuaderno:${id}`, kind: 'nota', title: `Cuaderno ${id}`, text, links: [] });
const charla = (id: string, text: string): SearchDoc => ({ id: `conversacion:${id}`, kind: 'conversacion', title: `Conversación ${id}`, text, links: [] });

function fixture(t: TestContext) {
  const store = tempStore(t);
  const { almacen, estructuraSha } = tempAlmacen(t);
  documento(store, 'doc-a', 'a', estructuraSha);
  cuaderno(store, 'nb-unidad', 'a', { unitId: 'u1' });
  cuaderno(store, 'nb-doc', 'a', { documentId: 'doc-a' });
  cuaderno(store, 'nb-suelto', 'a');
  cuaderno(store, 'nb-otro', 'b');
  const records = [
    registro({ id: 'HE-1', type: 'hecho', title: 'Atención en GNN', afirmacion: 'La red usa attention sobre sensores', sources: [{ id: 's1', resource: 'F-1', hash: ORIGINAL_SHA, ancla: 'pdf-v1:p=2' }] }),
    registro({ id: 'ENT-1', type: 'entidad', title: 'Attention', nombre: 'attention', alias: [], sources: [] }),
  ];
  const search = createKbSearch({
    records: () => records, documents: () => store.listDocuments(), almacen,
    notebooks: () => [nota('nb-unidad', 'attention en la unidad'), nota('nb-doc', 'attention en el paper'), nota('nb-suelto', 'attention suelta'), nota('nb-otro', 'attention de otro espacio')],
    conversations: () => [charla('c-a', 'hablamos de attention'), charla('c-b', 'attention en otro espacio')],
  });
  const espacios: Record<string, string[]> = { a: ['c-a'], b: ['c-b'] };
  const buscar = createPaleta({
    search: (q, o) => search.search(q, o), store,
    conversaciones: f => (f === null ? ['c-a', 'c-b'] : espacios[f] ?? []).map(id => ({ id })),
    registro: id => records.find(r => r.header.id === id)?.header ?? null,
  });
  return { buscar };
}

const ids = (r: BusquedaPaleta, tipo: string) => r.grupos.find(g => g.tipo === tipo)?.resultados.map(x => x.id) ?? [];

test('los resultados salen agrupados por tipo, en orden fijo, y solo los del espacio activo', t => {
  const { buscar } = fixture(t);
  const r = buscar({ consulta: 'attention' }, 'a');
  assert.deepEqual(r.grupos.map(g => g.tipo), ['conocimiento', 'documento', 'nota', 'conversacion']);
  assert.deepEqual(ids(r, 'nota').sort(), ['cuaderno:nb-doc', 'cuaderno:nb-suelto', 'cuaderno:nb-unidad']);
  assert.deepEqual(ids(r, 'conversacion'), ['conversacion:c-a']);
  assert.deepEqual(ids(r, 'conocimiento').sort(), ['ENT-1', 'HE-1'], 'la base no tiene espacio: sale siempre');
  assert.equal(r.vacio, null);
  assert.deepEqual(ids(buscar({ consulta: 'attention' }, null), 'conversacion').sort(), ['conversacion:c-a', 'conversacion:c-b'], '«Todos» no filtra');
});

test('cada resultado lleva su destino: página del documento, unidad o documento de la nota, conversación', t => {
  const { buscar } = fixture(t);
  const r = buscar({ consulta: 'attention' }, 'a');
  const todos = new Map(r.grupos.flatMap(g => g.resultados).map(x => [x.id, x]));
  const seccion = r.grupos.find(g => g.tipo === 'documento')!.resultados[0]!;
  assert.deepEqual(seccion.destino, { tipo: 'documento', documentId: 'doc-a', pagina: 2 });
  assert.equal(seccion.pagina, 2);
  assert.deepEqual(todos.get('cuaderno:nb-unidad')!.destino, { tipo: 'unidad', unitId: 'u1' });
  assert.deepEqual(todos.get('cuaderno:nb-doc')!.destino, { tipo: 'documento', documentId: 'doc-a', pagina: null });
  assert.deepEqual(todos.get('cuaderno:nb-suelto')!.destino, { tipo: 'cuaderno', notebookId: 'nb-suelto' });
  assert.deepEqual(todos.get('conversacion:c-a')!.destino, { tipo: 'conversacion', chatId: 'c-a' });
  assert.deepEqual(todos.get('HE-1')!.destino, { tipo: 'documento', documentId: 'doc-a', pagina: 2 }, 'un hecho lleva a la página que cita');
  assert.equal(todos.get('ENT-1')!.destino, null, 'una entidad sin cita no tiene adónde ir');
});

test('limitada a conversaciones (⌘⇧F), solo devuelve conversaciones; sin consulta no busca', t => {
  const { buscar } = fixture(t);
  const r = buscar({ consulta: 'attention', tipos: ['conversacion'] }, 'a');
  assert.deepEqual(r.grupos.map(g => g.tipo), ['conversacion']);
  assert.deepEqual(buscar({ consulta: '  ' }, 'a'), { grupos: [], vacio: 'consulta_vacia' });
  assert.equal(buscar({ consulta: 'inexistente' }, 'a').vacio, 'sin_coincidencias');
  assert.throws(() => buscar({ consulta: 'x', otra: 1 }, 'a'), /not allowed/);
});

test('la operación paleta del plugin busca notas y conversaciones del espacio activo', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-paleta-op-'));
  const kbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-paleta-kb-'));
  const previo = process.env.ESTUDIO_KB_DIR;
  process.env.ESTUDIO_KB_DIR = kbDir;
  const handlers = new Map<string, (input: unknown) => unknown>();
  const chats = [{ id: 'chat-grafos', title: 'Dijkstra paso a paso', createdAt: AT, updatedAt: AT, kind: 'teach', messageCount: 2, busy: false }];
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: new AbortController().signal, cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: { getSession: (id: string) => (id === 'chat-grafos' ? { ...chats[0], messages: [] } : null), listSessions: () => chats },
    registerInstructions() { return () => {}; }, registerTools() { return () => {}; },
    inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error('sin modelo'); } },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  t.after(async () => {
    await stop();
    if (previo === undefined) delete process.env.ESTUDIO_KB_DIR; else process.env.ESTUDIO_KB_DIR = previo;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(kbDir, { recursive: true, force: true });
  });
  const call = async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;

  const grafos = await call<{ id: string }>('crear-espacio', { name: 'Grafos' });
  const otro = await call<{ id: string }>('crear-espacio', { name: 'Otro' });
  await call('activar-espacio', { areaId: otro.id });
  await call('crear-cuaderno', { title: 'Dijkstra en otro espacio', kind: 'libre' });
  await call('activar-espacio', { areaId: grafos.id });
  const unidad = await call<{ id: string }>('crear-unidad', { title: 'Caminos mínimos' });
  const nb = await call<{ id: string }>('crear-cuaderno', { title: 'Dijkstra', kind: 'libre', unitId: unidad.id });

  const r = await call<BusquedaPaleta>('paleta', { consulta: 'dijkstra' });
  const notas = r.grupos.find(g => g.tipo === 'nota')!.resultados;
  assert.deepEqual(notas.map(n => [n.id, n.destino]), [[`cuaderno:${nb.id}`, { tipo: 'unidad', unitId: unidad.id }]]);
  assert.equal(r.grupos.find(g => g.tipo === 'conversacion'), undefined, 'la conversación no es de este espacio');
  await call('activar-espacio', { areaId: null });
  const solo = await call<BusquedaPaleta>('paleta', { consulta: 'dijkstra', tipos: ['conversacion'] });
  assert.deepEqual(solo.grupos.map(g => [g.tipo, g.resultados.map(x => x.destino)]), [['conversacion', [{ tipo: 'conversacion', chatId: 'chat-grafos' }]]]);
});
