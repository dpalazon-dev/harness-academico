/**
 * Lecturas del armazón de estudio (ticket 02): el plan del espacio activo para
 * la barra lateral y la lectura completa de una unidad para su página, ambas
 * llamadas por nombre como las vistas, con el plugin activado. Las reglas del
 * ciclo sobre hechos están en `hechos-ciclo.test.ts`.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';
import { openStudyStore, type StudyStore } from '../src/study/store.ts';
import { answerHash } from '../src/practice/schema.ts';

interface Chat { id: string; title: string; updatedAt: string; messages: number }

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-armazon-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const chats = new Map<string, Chat>();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on() { return () => {}; } },
    learning: {
      getSession: (id: string) => {
        const c = chats.get(id);
        return c ? { id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, messages: [] } : null;
      },
      listSessions: () => [...chats.values()].map(c => ({ id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, kind: 'teach', messageCount: c.messages, busy: false })),
    },
    registerInstructions() { return () => {}; },
    registerTools() { return () => {}; },
    inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error('sin modelo en estas pruebas'); } },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  // El mismo directorio que abre el plugin: sirve para sembrar documentos, cuadernos e intentos.
  const store = openStudyStore(path.join(ctx.dataDirectory, 'study'));
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;
  return { call, store, chats };
}

type Unit = { id: string; revision: number; title: string };
type Grupo = 'hecho' | 'pendiente' | 'vacio';
interface Lectura {
  id: string; revision: number; titulo: string; estado: string; capacidad: string; criterio: string; planId: string | null;
  tipo: string | null; practica: string | null; practicaEfectiva: string;
  etapa: { kind: string; label: string };
  ciclo: { orientar: Grupo; exponer: Grupo; reconstruir: Grupo; mantener: Grupo };
  volcado: { texto: string; fecha: string; origen: string } | null;
  fuentes: { documentoId: string | null; titulo: string; localizador: string | null; capturas: number; ultimaCaptura: string | null; reconstruida: boolean }[];
  notas: { texto: string; simbolo: string | null; localizador: string; cuaderno: string }[];
  cuadernos: { id: string; titulo: string; tipo: string; notas: number; preguntas: number; actualizado: string }[];
  preguntas: { pregunta: string; cuaderno: string }[];
  intentos: { id: string; fecha: string; tarea: string; estado: string; fidelidad: number | null }[];
  proximoRepaso: string | null;
  conversaciones: { id: string; title: string }[];
}
interface LecturaPlan {
  plan: { id: string; objetivo: string } | null;
  unidades: { id: string; titulo: string; propuesta: boolean; fueraDelPlan: boolean; ciclo: Lectura['ciclo'] }[];
}

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();
/** Un instante unos segundos en el futuro: posterior a cualquier hecho registrado ahora. */
const despues = (segundos: number) => new Date(Date.now() + segundos * 1000).toISOString();

function documento(store: StudyStore, id: string, title: string, areaId: string | null) {
  store.saveDocument({
    id, revision: 1, title, path: `C:/${id}.pdf`, status: 'listo', error: null, startedAt: hace(600), finishedAt: hace(590),
    original: { sha256: 'a'.repeat(64), bytes: 10 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 12, contraste: null, revisar: [], areaId,
  }, null);
}

function notaDeFuente(store: StudyStore, documentId: string, notas: number, updatedAt: string, areaId: string | null) {
  store.saveNotebook({
    id: `nb-${documentId}`, revision: 1, title: 'Notas de la fuente', kind: 'fuente', unitId: null, documentId,
    blocks: Array.from({ length: notas }, (_, i) => ({ id: `b${i}`, kind: 'nota' as const, symbol: null, text: `nota ${i}`, locator: `p. ${i + 1}`, quote: '' })),
    createdAt: updatedAt, updatedAt, areaId,
  }, null);
}

function intento(store: StudyStore, unitId: string, id: string, frozenAt: string, graded: boolean, sourceOpened = false) {
  store.saveTask({ id: `t-${id}`, revision: 1, unitId, kind: 'libre', prompt: 'Explica', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: frozenAt, model: { provider: 'p', id: 'm' } }, null);
  store.saveAttempt({
    id, revision: 1, unitId, taskId: `t-${id}`, taskKind: 'libre', openedAt: frozenAt, confidence: 50,
    cueLevel: sourceOpened ? 6 : 0, cueLevelAtFreeze: sourceOpened ? 6 : 0, answer: 'a', answerHash: answerHash('a'), frozenAt,
    status: graded ? 'graded' : 'frozen', contextLabel: 'libre', judgments: [],
    grades: graded ? [{ fidelity: 3, use: null, failureType: null, gradedAt: frozenAt, correction: false }] : [],
  }, null);
}

async function espacio(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<string> {
  const area = await f.call<{ id: string }>('crear-espacio', { name });
  await f.call('activar-espacio', { areaId: area.id });
  return area.id;
}

async function planCon(f: Awaited<ReturnType<typeof fixture>>, titulos: string[]): Promise<Unit[]> {
  await f.call('crear-plan', { goal: 'Dominar grafos' });
  const units: Unit[] = [];
  for (const title of titulos) units.push(await f.call<Unit>('crear-unidad', { title, capability: `Explicar ${title}`, criterion: `Lo explico sin mirar` }));
  const proposal = await f.call<{ id: string }>('proponer-cambio', { ops: units.map(u => ({ op: 'add', unitId: u.id })) });
  await f.call('aplicar-propuesta', { id: proposal.id });
  return units;
}

test('la lectura de una unidad trae capacidad, criterio, tipo, etapa, ciclo, fuentes, notas, preguntas, intentos, repaso y conversaciones', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  let [unit] = await planCon(f, ['Caminos mínimos']);
  unit = await f.call<Unit>('editar-unidad', { id: unit!.id, expectedRevision: unit!.revision, kind: 'procedimiento' });
  documento(f.store, 'doc-1', 'Cormen', area);
  unit = await f.call<Unit>('vincular-documento', { unitId: unit!.id, expectedRevision: unit!.revision, documentId: 'doc-1', locator: 'cap. 24' });
  await f.call('registrar-fuente-trabajada', { unitId: unit!.id, documentId: 'doc-1', capturas: 3 });
  const cuaderno = await f.call<{ id: string; revision: number }>('crear-cuaderno', { title: 'Mis notas de Dijkstra', kind: 'libre', unitId: unit!.id });
  await f.call('guardar-cuaderno', {
    id: cuaderno.id, expectedRevision: cuaderno.revision, unitId: unit!.id, title: 'Mis notas de Dijkstra', kind: 'libre',
    blocks: [
      { id: 'n1', kind: 'nota', symbol: '→', text: 'Relaja aristas en orden de distancia', locator: 'p. 3', quote: '' },
      { id: 'q1', kind: 'recuperacion', question: '¿Por qué falla con pesos negativos?', answer: 'Porque…' },
    ],
  });
  intento(f.store, unit!.id, 'a1', new Date(Date.now() + 1000).toISOString(), true);
  f.chats.set('chat-u', { id: 'chat-u', title: 'Dudas de Dijkstra', updatedAt: hace(30), messages: 2 });
  f.store.saveConversation({ id: 'chat-u', revision: 1, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId: area, unitId: null, origen: null }, null);
  // Un vínculo por el tráfico de herramientas no se puede sembrar sin transcripción: basta con la unidad nacida en la conversación.
  const actual = f.store.getUnit(unit!.id)!;
  f.store.saveUnit({ ...actual, revision: actual.revision + 1, origin: { kind: 'tutor', chatId: 'chat-u' } }, actual.revision);

  const u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.equal(u.titulo, 'Caminos mínimos');
  assert.equal(u.capacidad, 'Explicar Caminos mínimos');
  assert.equal(u.criterio, 'Lo explico sin mirar');
  assert.equal(u.estado, 'activa');
  assert.equal(u.tipo, 'procedimiento');
  assert.equal(u.practica, null);
  assert.equal(u.practicaEfectiva, 'ejecutar');
  assert.equal(u.etapa.kind, 'intervalo');
  assert.equal(u.fuentes.length, 1);
  assert.match(u.fuentes[0]!.ultimaCaptura ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({ ...u.fuentes[0], ultimaCaptura: null }, { path: 'documento:doc-1', documentoId: 'doc-1', titulo: 'Cormen', paginas: 12, localizador: 'cap. 24', capturas: 3, ultimaCaptura: null, reconstruida: true });
  assert.equal(u.volcado, null);
  assert.deepEqual(u.notas.map(n => [n.simbolo, n.texto, n.localizador, n.cuaderno]), [['→', 'Relaja aristas en orden de distancia', 'p. 3', 'Mis notas de Dijkstra']]);
  assert.deepEqual(u.preguntas.map(q => [q.pregunta, q.cuaderno]), [['¿Por qué falla con pesos negativos?', 'Mis notas de Dijkstra']]);
  assert.deepEqual(u.cuadernos.map(c => [c.id, c.titulo, c.tipo, c.notas, c.preguntas]), [[cuaderno.id, 'Mis notas de Dijkstra', 'libre', 1, 1]]);
  assert.deepEqual(u.intentos.map(i => [i.id, i.tarea, i.estado, i.fidelidad]), [['a1', 'libre', 'graded', 3]]);
  assert.match(u.proximoRepaso ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(u.conversaciones.map(c => [c.id, c.title]), [['chat-u', 'Dudas de Dijkstra']]);
  assert.deepEqual(u.ciclo, { orientar: 'pendiente', exponer: 'hecho', reconstruir: 'hecho', mantener: 'hecho' });
});

test('una unidad de otro espacio no se lee mientras ese espacio no está activo; con «Todos», sí', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Caminos mínimos']);
  const otro = await espacio(f, 'Física');
  await assert.rejects(async () => f.call('unidad', { id: unit!.id }), /no existe/);
  await f.call('activar-espacio', { areaId: null });
  assert.equal((await f.call<Lectura>('unidad', { id: unit!.id })).titulo, 'Caminos mínimos');
  assert.ok(otro);
  await assert.rejects(async () => f.call('unidad', { id: 'nada' }), /no existe/);
});

test('el ciclo de una unidad sin nada empieza con orientar pendiente y el resto sin empezar', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Caminos mínimos']);
  const u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.deepEqual(u.ciclo, { orientar: 'pendiente', exponer: 'vacio', reconstruir: 'vacio', mantener: 'vacio' });
  assert.deepEqual([u.fuentes, u.notas, u.preguntas, u.cuadernos, u.intentos, u.conversaciones], [[], [], [], [], [], []]);
  assert.equal(u.etapa.kind, 'nueva');
  assert.equal(u.proximoRepaso, null);
});

test('una fuente trabajada deja la reconstrucción pendiente hasta un intento posterior sin abrir la fuente', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  let [unit] = await planCon(f, ['Caminos mínimos']);
  documento(f.store, 'doc-1', 'Cormen', area);
  documento(f.store, 'doc-2', 'Sedgewick', area);
  unit = await f.call<Unit>('vincular-documento', { unitId: unit!.id, expectedRevision: unit!.revision, documentId: 'doc-1' });
  unit = await f.call<Unit>('vincular-documento', { unitId: unit!.id, expectedRevision: unit!.revision, documentId: 'doc-2' });
  intento(f.store, unit!.id, 'antes', hace(300), false);
  await f.call('registrar-fuente-trabajada', { unitId: unit!.id, documentId: 'doc-1', capturas: 2 });

  let u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.deepEqual(u.fuentes.map(s => [s.titulo, s.capturas, s.reconstruida]), [['Cormen', 2, false], ['Sedgewick', 0, false]]);
  assert.equal(u.ciclo.exponer, 'hecho');
  assert.equal(u.ciclo.reconstruir, 'pendiente', 'un intento anterior a la captura no la reconstruye');

  intento(f.store, unit!.id, 'mirando', despues(1), false, true);
  u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.equal(u.ciclo.reconstruir, 'pendiente', 'abrir la fuente durante el intento no es reconstruir sin mirar');

  intento(f.store, unit!.id, 'sin-mirar', despues(2), false);
  u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.deepEqual(u.fuentes.map(s => s.reconstruida), [true, false]);
  assert.equal(u.ciclo.reconstruir, 'hecho');
  assert.equal(u.ciclo.mantener, 'vacio', 'sin intentos valorados aún no hay repaso que mantener');
  assert.deepEqual(u.intentos.map(i => i.id), ['sin-mirar', 'mirando', 'antes']);
});

test('un intento sin fuentes ni capturas ya cuenta como reconstruir y contrastar', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Caminos mínimos']);
  intento(f.store, unit!.id, 'a1', hace(10), false);
  assert.equal((await f.call<Lectura>('unidad', { id: unit!.id })).ciclo.reconstruir, 'hecho');
});

test('mantener y usar queda pendiente si la unidad está reaprendiendo', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Caminos mínimos']);
  f.store.saveTask({ id: 't1', revision: 1, unitId: unit!.id, kind: 'libre', prompt: 'p', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: hace(60), model: { provider: 'p', id: 'm' } }, null);
  f.store.saveAttempt({
    id: 'a1', revision: 1, unitId: unit!.id, taskId: 't1', taskKind: 'libre', openedAt: hace(60), confidence: 90, cueLevel: 0, cueLevelAtFreeze: 0,
    answer: 'a', answerHash: answerHash('a'), frozenAt: hace(59), status: 'graded', contextLabel: 'libre', judgments: [],
    grades: [{ fidelity: 0, use: null, failureType: 'acceso', gradedAt: hace(58), correction: false }],
  }, null);
  const u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.equal(u.etapa.kind, 'reaprendiendo');
  assert.equal(u.ciclo.mantener, 'pendiente');
});

test('el plan del espacio activo trae sus unidades en orden con su ciclo y después las propuestas del tutor', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [a, b] = await planCon(f, ['Recorridos', 'Caminos mínimos']);
  const propuesta = await f.call<{ id: string; revision: number }>('proponer-cambio', { ops: [{ op: 'move', unitId: b!.id, index: 0 }] });
  await f.call('aplicar-propuesta', { id: propuesta.id });
  const archivada = await f.call<Unit>('crear-unidad', { title: 'Vieja' });
  await f.call('archivar-unidad', { id: archivada.id, expectedRevision: archivada.revision });
  // Las unidades que propone el tutor nacen como «propuesta» y fuera del plan.
  const area = (await f.call<{ activeAreaId: string }>('espacios')).activeAreaId;
  f.store.saveUnit({
    id: 'prop-1', revision: 1, createdAt: hace(5), updatedAt: hace(5), status: 'propuesta', title: 'Flujo máximo', capability: '', criterion: '',
    kind: null, policy: null, graphNodeIds: [], sources: [], checkIds: [], origin: { kind: 'tutor', chatId: 'c' }, notes: '', areaId: area,
  }, null);

  const p = await f.call<LecturaPlan>('plan');
  assert.equal(p.plan?.objetivo, 'Dominar grafos');
  assert.deepEqual(p.unidades.map(u => [u.titulo, u.propuesta, u.fueraDelPlan]), [
    ['Caminos mínimos', false, false], ['Recorridos', false, false], ['Flujo máximo', true, true],
  ]);
  assert.deepEqual(p.unidades[0]!.ciclo, { orientar: 'pendiente', exponer: 'vacio', reconstruir: 'vacio', mantener: 'vacio' });
  assert.ok(a);

  await espacio(f, 'Física');
  assert.deepEqual(await f.call<LecturaPlan>('plan'), { plan: null, unidades: [] });
});

test('las unidades activas fuera del plan se listan detrás, marcadas, para no perderlas', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  await planCon(f, ['Recorridos']);
  await f.call('crear-unidad', { title: 'Suelta' });
  const p = await f.call<LecturaPlan>('plan');
  assert.deepEqual(p.unidades.map(u => [u.titulo, u.propuesta, u.fueraDelPlan]), [['Recorridos', false, false], ['Suelta', false, true]]);
});

test('la lectura de una unidad lleva el plan de su espacio, también con «Todos» activo', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Recorridos']);
  const planGrafos = (await f.call<LecturaPlan>('plan')).plan!.id;
  await espacio(f, 'Física');
  await f.call('crear-plan', { goal: 'Mecánica' });
  await f.call('activar-espacio', { areaId: null });
  assert.equal((await f.call<Lectura>('unidad', { id: unit!.id })).planId, planGrafos);
});

test('un registro antiguo sin hechos se lee como «sin hechos»: las notas de cuadernos no cuentan como capturas', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  let [unit] = await planCon(f, ['Caminos mínimos']);
  documento(f.store, 'doc-1', 'Cormen', area);
  unit = await f.call<Unit>('vincular-documento', { unitId: unit!.id, expectedRevision: unit!.revision, documentId: 'doc-1' });
  notaDeFuente(f.store, 'doc-1', 2, hace(100), area);
  const u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.deepEqual(u.fuentes.map(s => [s.capturas, s.ultimaCaptura, s.reconstruida]), [[0, null, false]]);
  assert.deepEqual(u.ciclo, { orientar: 'pendiente', exponer: 'vacio', reconstruir: 'vacio', mantener: 'vacio' });
  assert.equal(u.volcado, null);
});

test('un cuaderno vinculado a la unidad sale en su lectura aunque aún no tenga bloques (ticket 09)', async t => {
  const f = await fixture(t);
  await espacio(f, 'Grafos');
  const [unit, otra] = await planCon(f, ['Caminos mínimos', 'Recorridos']);
  const vacio = await f.call<{ id: string }>('crear-cuaderno', { title: 'Sin título', kind: 'libre', unitId: unit!.id });
  await f.call('crear-cuaderno', { title: 'De otra unidad', kind: 'libre', unitId: otra!.id });
  await f.call('crear-cuaderno', { title: 'Suelto', kind: 'libre' });
  const u = await f.call<Lectura>('unidad', { id: unit!.id });
  assert.deepEqual(u.cuadernos.map(c => [c.id, c.titulo, c.notas, c.preguntas]), [[vacio.id, 'Sin título', 0, 0]]);
  assert.match(u.cuadernos[0]!.actualizado, /^\d{4}-\d{2}-\d{2}T/);
});

test('exportar todas las preguntas a Anki solo lleva las del espacio activo (ticket 09)', async t => {
  const f = await fixture(t);
  const pregunta = async (title: string) => {
    const nb = await f.call<{ id: string; revision: number }>('crear-cuaderno', { title, kind: 'libre' });
    await f.call('guardar-cuaderno', { id: nb.id, expectedRevision: nb.revision, title, kind: 'libre', unitId: null, documentId: null,
      blocks: [{ id: `q-${title}`, kind: 'recuperacion', question: `¿${title}?`, answer: 'Sí' }] });
  };
  await espacio(f, 'Grafos');
  await pregunta('Dijkstra');
  await espacio(f, 'Física');
  await pregunta('Newton');
  const fisica = await f.call<{ text: string; count: number }>('exportar-anki', {});
  assert.equal(fisica.count, 1);
  assert.match(fisica.text, /¿Newton\?/);
  assert.doesNotMatch(fisica.text, /Dijkstra/);
  await f.call('activar-espacio', { areaId: null });
  assert.equal((await f.call<{ count: number }>('exportar-anki', {})).count, 2);
});

test('un cuaderno nacido de una unidad es del espacio de la unidad, aunque esté activo «Todos» (ticket 09)', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Flujo máximo']);
  await f.call('activar-espacio', { areaId: null });
  const nb = await f.call<{ areaId: string | null }>('crear-cuaderno', { title: 'Ford-Fulkerson', kind: 'libre', unitId: unit!.id });
  assert.equal(nb.areaId, area);
  const suelto = await f.call<{ areaId: string | null }>('crear-cuaderno', { title: 'Suelto', kind: 'libre' });
  assert.equal(suelto.areaId, null, 'sin unidad, el del espacio activo: ninguno con «Todos»');
  await f.call('activar-espacio', { areaId: area });
  assert.deepEqual((await f.call<{ title: string }[]>('cuadernos')).map(n => n.title), ['Ford-Fulkerson']);
});

interface LugarEnPlan { posicion: number; total: number; subir: number | null; bajar: number | null }
type ConLugar = Lectura & { areaId: string | null; lugarEnPlan: LugarEnPlan | null };

test('la lectura de una unidad dice su espacio y su lugar en el plan, sin contar las archivadas (ticket 11)', async t => {
  const f = await fixture(t);
  const grafos = await espacio(f, 'Grafos');
  const [a, b, c, d] = await planCon(f, ['A', 'B', 'C', 'D']);
  const suelta = await f.call<Unit>('crear-unidad', { title: 'Suelta' });
  await f.call('archivar-unidad', { id: b!.id, expectedRevision: (await f.call<Lectura>('unidad', { id: b!.id })).revision });
  const lugar = async (id: string) => (await f.call<ConLugar>('unidad', { id })).lugarEnPlan;
  // B archivada sigue en la lista del plan (índice 1): C es la segunda visible y sube al sitio de A, baja al de D.
  assert.deepEqual(await lugar(c!.id), { posicion: 2, total: 3, subir: 0, bajar: 3 });
  assert.deepEqual(await lugar(a!.id), { posicion: 1, total: 3, subir: null, bajar: 2 });
  assert.deepEqual(await lugar(d!.id), { posicion: 3, total: 3, subir: 2, bajar: null });
  assert.equal(await lugar(suelta.id), null);
  assert.equal((await f.call<ConLugar>('unidad', { id: a!.id })).areaId, grafos);

  // Los índices sirven tal cual para el cambio del plan: C sube por encima de A.
  const plan = (await f.call<LecturaPlan>('plan')).plan!.id;
  const prop = await f.call<{ id: string }>('proponer-cambio', { planId: plan, ops: [{ op: 'move', unitId: c!.id, index: 0 }] });
  await f.call('aplicar-propuesta', { id: prop.id });
  assert.deepEqual((await f.call<LecturaPlan>('plan')).unidades.filter(u => !u.fueraDelPlan).map(u => u.titulo), ['C', 'A', 'D']);
  // A baja al sitio de la siguiente visible, D.
  const conA = await lugar(a!.id);
  const prop2 = await f.call<{ id: string }>('proponer-cambio', { planId: plan, ops: [{ op: 'move', unitId: a!.id, index: conA!.bajar! }] });
  await f.call('aplicar-propuesta', { id: prop2.id });
  assert.deepEqual((await f.call<LecturaPlan>('plan')).unidades.filter(u => !u.fueraDelPlan).map(u => u.titulo), ['C', 'D', 'A']);
});

test('cada conversación de la unidad trae su resumen (tema, quedó abierto, siguiente) y si es anterior a los últimos mensajes (ticket 11)', async t => {
  const f = await fixture(t);
  const area = await espacio(f, 'Grafos');
  const [unit] = await planCon(f, ['Caminos mínimos']);
  const resumen = { tema: 'Dijkstra con pesos negativos', trabajado: ['relajación'], claro: [], abierto: ['¿Y Bellman-Ford?'], siguiente: 'Reconstruir sin mirar' };
  const registro = (id: string, summary: typeof resumen | null, summaryOf: string | null, summaryError: string | null = null) =>
    f.store.saveConversation({ id, revision: 1, briefing: null, briefedAt: null, summary, summaryOf, summarizedAt: summaryOf, summaryError, areaId: area, unitId: unit!.id, origen: null }, null);
  const al = hace(30);
  f.chats.set('chat-al-dia', { id: 'chat-al-dia', title: 'Al día', updatedAt: al, messages: 4 });
  registro('chat-al-dia', resumen, al);
  f.chats.set('chat-viejo', { id: 'chat-viejo', title: 'Viejo', updatedAt: hace(5), messages: 6 });
  registro('chat-viejo', resumen, hace(60));
  f.chats.set('chat-sin', { id: 'chat-sin', title: 'Sin resumen', updatedAt: hace(2), messages: 1 });
  registro('chat-sin', null, null, 'El modelo no respondió');

  type Conv = { id: string; resumen: { tema: string; abierto: string[]; siguiente: string } | null; resumenAntiguo: boolean; resumenError: string | null };
  const u = await f.call<{ conversaciones: Conv[] }>('unidad', { id: unit!.id });
  const por = new Map(u.conversaciones.map(c => [c.id, c]));
  assert.deepEqual(por.get('chat-al-dia'), { ...por.get('chat-al-dia'), resumen: { tema: resumen.tema, abierto: resumen.abierto, siguiente: resumen.siguiente }, resumenAntiguo: false, resumenError: null });
  assert.equal(por.get('chat-viejo')!.resumenAntiguo, true);
  assert.deepEqual([por.get('chat-sin')!.resumen, por.get('chat-sin')!.resumenError], [null, 'El modelo no respondió']);
});
