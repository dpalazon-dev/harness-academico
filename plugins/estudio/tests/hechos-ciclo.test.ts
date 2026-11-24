/**
 * Hechos del ciclo (ticket 04, ADR 0004): volcado inicial, fuente trabajada y
 * cierre de bloque, y el estado de los cuatro grupos que sale de ellos y de la
 * evidencia de práctica. Todo por las operaciones del plugin activado, como lo
 * llama el armazón; el volcado del sondeo y el cierre del tutor, por el evento
 * de turno asentado y la herramienta que ve el tutor.
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

type Tool = { name: string; execute: (id: string, input: unknown, signal?: AbortSignal) => Promise<{ details: unknown; isError?: boolean }> };

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-hechos-'));
  const controller = new AbortController();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const listeners: ((event: unknown) => void)[] = [];
  const toolFactories: ((context: unknown) => Tool[])[] = [];
  const sessions = new Map<string, { id: string; messages: unknown[] }>();
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: controller.signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit() {}, on(listener: (event: unknown) => void) { listeners.push(listener); return () => {}; } },
    learning: {
      getSession: (id: string) => {
        const s = sessions.get(id);
        return s ? { id, title: 'Conversación', createdAt: hace(10), updatedAt: hace(1), messages: s.messages } : null;
      },
      listSessions: () => [],
    },
    registerInstructions() { return () => {}; },
    registerTools(spec: { create: (context: unknown) => Tool[] }) { toolFactories.push(spec.create); return () => {}; },
    inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error('sin modelo en estas pruebas'); } },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  const store = openStudyStore(path.join(ctx.dataDirectory, 'study'));
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;
  /** Una conversación del núcleo con sus mensajes y el aviso de turno asentado que la acompaña. */
  const turno = (chatId: string, messages: unknown[]) => {
    sessions.set(chatId, { id: chatId, messages });
    for (const listener of listeners) listener({ type: 'turn-settled', chatId });
  };
  const herramienta = (chatId: string, name: string) => toolFactories.flatMap(c => c({ chatId, agent: 'teacher' })).find(x => x.name === name)!;
  return { call, store, turno, herramienta };
}

type Grupo = 'hecho' | 'pendiente' | 'vacio';
interface Lectura {
  id: string; revision: number;
  ciclo: { orientar: Grupo; exponer: Grupo; reconstruir: Grupo; mantener: Grupo };
  volcado: { texto: string; fecha: string; origen: string } | null;
  fuentes: { documentoId: string | null; capturas: number; ultimaCaptura: string | null; reconstruida: boolean }[];
  etapa: { kind: string };
}
type Unit = { id: string; revision: number };

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();
const despues = (segundos: number) => new Date(Date.now() + segundos * 1000).toISOString();

async function unidad(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}): Promise<Unit> {
  const area = await f.call<{ id: string }>('crear-espacio', { name: 'Grafos' });
  await f.call('activar-espacio', { areaId: area.id });
  return await f.call<Unit>('crear-unidad', { title: 'Caminos mínimos', capability: 'Explicar Dijkstra', ...extra });
}

async function conFuente(f: Awaited<ReturnType<typeof fixture>>, unit: Unit, documentId = 'doc-1'): Promise<Unit> {
  f.store.saveDocument({
    id: documentId, revision: 1, title: `Libro ${documentId}`, path: `C:/${documentId}.pdf`, status: 'listo', error: null, startedAt: hace(600), finishedAt: hace(590),
    original: { sha256: 'a'.repeat(64), bytes: 10 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 12, contraste: null, revisar: [], areaId: null,
  }, null);
  return await f.call<Unit>('vincular-documento', { unitId: unit.id, expectedRevision: unit.revision, documentId });
}

function intento(store: StudyStore, unitId: string, id: string, at: string, opciones: { graded?: boolean; fidelity?: 0 | 1 | 2 | 3; mirando?: boolean; status?: 'open' | 'abandoned'; kind?: 'libre' | 'aplicada'; use?: 0 | 1 | 2 | null; taskId?: string } = {}) {
  const taskId = opciones.taskId ?? `t-${id}`;
  const kind = opciones.kind ?? 'libre';
  if (!store.getTask(taskId)) store.saveTask({ id: taskId, revision: 1, unitId, kind, prompt: 'Explica', cues: ['1', '2', '3', '4', '5'], reference: 'r', rubric: ['r'], createdAt: at, model: { provider: 'p', id: 'm' } }, null);
  const terminado = opciones.status === undefined;
  const graded = terminado && (opciones.graded ?? false);
  store.saveAttempt({
    id, revision: 1, unitId, taskId, taskKind: kind, openedAt: at, confidence: 80,
    cueLevel: opciones.mirando ? 6 : 0, cueLevelAtFreeze: terminado ? (opciones.mirando ? 6 : 0) : null, answer: 'a', answerHash: answerHash('a'),
    frozenAt: terminado ? at : null, status: opciones.status ?? (graded ? 'graded' : 'frozen'), contextLabel: kind, judgments: [],
    grades: graded ? [{ fidelity: opciones.fidelity ?? 3, use: opciones.use ?? null, failureType: (opciones.fidelity ?? 3) < 2 ? 'acceso' : null, gradedAt: at, correction: false }] : [],
  }, null);
}

const leer = (f: Awaited<ReturnType<typeof fixture>>, unit: Unit) => f.call<Lectura>('unidad', { id: unit.id });

// ─── Volcado inicial ─────────────────────────────────────────────────────────

test('el volcado se guarda desde la página, se lee como «lo que sabía antes» y orienta la unidad', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  await f.call('guardar-volcado', { unitId: unit.id, texto: '  Sé que Dijkstra usa una cola de prioridad.\n¿Por qué falla con pesos negativos?  ' });
  const u = await leer(f, unit);
  assert.equal(u.volcado?.texto, 'Sé que Dijkstra usa una cola de prioridad.\n¿Por qué falla con pesos negativos?');
  assert.equal(u.volcado?.origen, 'pagina');
  assert.match(u.volcado?.fecha ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(u.ciclo.orientar, 'hecho');
  assert.equal(u.ciclo.exponer, 'pendiente', 'con volcado y sin capturas, exponer y capturar queda pendiente');
  // La barra lateral lee el mismo ciclo (aquí, entre las unidades sin plan).
  const planes = await f.call<{ sinPlan: { id: string; ciclo: Lectura['ciclo'] }[] }>('planes');
  assert.equal(planes.sinPlan.find(x => x.id === unit.id)?.ciclo.orientar, 'hecho');
});

test('el volcado es el «antes»: no se reescribe, no puede estar vacío y no se escribe en una unidad archivada', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  await assert.rejects(async () => f.call('guardar-volcado', { unitId: unit.id, texto: '   ' }), /must not be empty/);
  await f.call('guardar-volcado', { unitId: unit.id, texto: 'Primero' });
  await assert.rejects(async () => f.call('guardar-volcado', { unitId: unit.id, texto: 'Segundo' }), /ya tiene volcado/);
  assert.equal((await leer(f, unit)).volcado?.texto, 'Primero');
  const otra = await f.call<Unit>('crear-unidad', { title: 'Vieja' });
  await f.call('archivar-unidad', { id: otra.id, expectedRevision: otra.revision });
  await assert.rejects(async () => f.call('guardar-volcado', { unitId: otra.id, texto: 'x' }), /archivada/);
  await assert.rejects(async () => f.call('guardar-volcado', { unitId: 'nada', texto: 'x' }), /no existe/);
});

const contextoUnidad = (unitId: string) => ({ role: 'custom', customType: 'study-context', content: '[Study context]', display: true, details: { tipo: 'unidad', titulo: 'Caminos mínimos', lineas: [], unidadId: unitId }, timestamp: 1 });
const pregunta = (id: string, toolName = 'ask_user_question') => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: toolName, arguments: {} }], stopReason: 'toolUse', timestamp: 2 });
const respuesta = (id: string, details: unknown, toolName = 'ask_user_question') => ({ role: 'toolResult', toolCallId: id, toolName, content: [], details, isError: false, timestamp: 3 });

test('sin volcado, la primera respuesta libre al sondeador en una conversación de la unidad se guarda como su volcado', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  f.turno('chat-1', [contextoUnidad(unit.id), pregunta('q1'), respuesta('q1', { kind: 'ask', questionText: '¿Qué sabes ya?', text: 'Que relaja aristas.' })]);
  const u = await leer(f, unit);
  assert.equal(u.volcado?.texto, 'Que relaja aristas.');
  assert.equal(u.volcado?.origen, 'sondeo');
  assert.equal(u.ciclo.orientar, 'hecho');
  // Un turno posterior con otra respuesta no lo cambia.
  f.turno('chat-1', [contextoUnidad(unit.id), pregunta('q1'), respuesta('q1', { kind: 'ask', text: 'Que relaja aristas.' }), pregunta('q2'), respuesta('q2', { kind: 'ask', text: 'Otra cosa' })]);
  assert.equal((await leer(f, unit)).volcado?.texto, 'Que relaja aristas.');
});

test('lo escrito en «Otra» de una pregunta con opciones también es respuesta libre', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  f.turno('chat-1', [contextoUnidad(unit.id), pregunta('q1'), respuesta('q1', { kind: 'ask', answers: [], other: 'Sé poco: solo BFS.' })]);
  assert.equal((await leer(f, unit)).volcado?.texto, 'Sé poco: solo BFS.');
});

test('el sondeo no deja volcado si David salta la pregunta, si ya había uno, tras concluir el sondeo o fuera de una conversación de unidad', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  // Saltada: la respuesta libre de una pregunta posterior no es su volcado.
  f.turno('salta', [contextoUnidad(unit.id), pregunta('q1'), respuesta('q1', { kind: 'ask', dismissed: true }), pregunta('q2'), respuesta('q2', { kind: 'ask', text: 'Una aclaración' })]);
  // Después de probe_done ya no es el volcado del sondeo.
  f.turno('tarde', [contextoUnidad(unit.id), pregunta('p', 'probe_done'), respuesta('p', { ok: true }, 'probe_done'), pregunta('q1'), respuesta('q1', { kind: 'ask', text: 'Tarde' })]);
  // Una conversación de pasaje, aunque lleve la unidad, no pide volcado.
  f.turno('pasaje', [{ ...contextoUnidad(unit.id), details: { tipo: 'pasaje', titulo: 'x', lineas: [], unidadId: unit.id } }, pregunta('q1'), respuesta('q1', { kind: 'ask', text: 'Del pasaje' })]);
  // Sin contexto de estudio.
  f.turno('suelta', [pregunta('q1'), respuesta('q1', { kind: 'ask', text: 'Suelta' })]);
  assert.equal((await leer(f, unit)).volcado, null);

  await f.call('guardar-volcado', { unitId: unit.id, texto: 'El de la página' });
  f.turno('despues', [contextoUnidad(unit.id), pregunta('q1'), respuesta('q1', { kind: 'ask', text: 'El del sondeo' })]);
  assert.equal((await leer(f, unit)).volcado?.texto, 'El de la página');
});

// ─── Fuente trabajada y reconstrucción ───────────────────────────────────────

test('la fuente trabajada suma capturas y fecha la última; solo vale para una fuente de la unidad', async t => {
  const f = await fixture(t);
  let unit = await unidad(f);
  await assert.rejects(async () => f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 2 }), /no es una fuente/);
  unit = await conFuente(f, unit);
  await assert.rejects(async () => f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 0 }), /integer from 1/);
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 2 });
  const primera = (await leer(f, unit)).fuentes[0]!.ultimaCaptura!;
  await new Promise(r => setTimeout(r, 5));
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 3 });
  const u = await leer(f, unit);
  assert.equal(u.fuentes[0]!.capturas, 5);
  assert.ok(u.fuentes[0]!.ultimaCaptura! > primera);
  assert.equal(u.ciclo.exponer, 'hecho', 'exponer y capturar se hace con alguna fuente con capturas, aun sin volcado');
  assert.equal(u.ciclo.reconstruir, 'pendiente');
});

test('un cierre de bloque posterior a la última captura la reconstruye; una captura nueva la vuelve a dejar pendiente', async t => {
  const f = await fixture(t);
  const unit = await conFuente(f, await unidad(f));
  await f.call('registrar-cierre-bloque', { unitId: unit.id });
  await new Promise(r => setTimeout(r, 5));
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 1 });
  assert.equal((await leer(f, unit)).ciclo.reconstruir, 'pendiente', 'un cierre anterior a la captura no la reconstruye');
  await new Promise(r => setTimeout(r, 5));
  await f.call('registrar-cierre-bloque', { unitId: unit.id });
  let u = await leer(f, unit);
  assert.equal(u.fuentes[0]!.reconstruida, true);
  assert.equal(u.ciclo.reconstruir, 'hecho');
  await new Promise(r => setTimeout(r, 5));
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 1 });
  u = await leer(f, unit);
  assert.equal(u.fuentes[0]!.reconstruida, false);
  assert.equal(u.ciclo.reconstruir, 'pendiente');
});

test('un intento sin mirar posterior a la última captura cuenta como reconstrucción; uno mirando o anterior, no', async t => {
  const f = await fixture(t);
  const unit = await conFuente(f, await unidad(f));
  intento(f.store, unit.id, 'antes', hace(60));
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 2 });
  intento(f.store, unit.id, 'mirando', despues(1), { mirando: true });
  assert.equal((await leer(f, unit)).ciclo.reconstruir, 'pendiente');
  intento(f.store, unit.id, 'sin-mirar', despues(2));
  const u = await leer(f, unit);
  assert.equal(u.fuentes[0]!.reconstruida, true);
  assert.equal(u.ciclo.reconstruir, 'hecho');
});

test('reconstruir y contrastar: sin fuentes pendientes, hecho con un cierre o un intento terminado; sin nada, sin empezar', async t => {
  const f = await fixture(t);
  const a = await unidad(f);
  assert.equal((await leer(f, a)).ciclo.reconstruir, 'vacio');
  intento(f.store, a.id, 'abierto', hace(5), { status: 'open' });
  intento(f.store, a.id, 'abandonado', hace(4), { status: 'abandoned' });
  assert.equal((await leer(f, a)).ciclo.reconstruir, 'vacio', 'un intento abierto o abandonado no es evidencia');
  await f.call('registrar-cierre-bloque', { unitId: a.id });
  assert.equal((await leer(f, a)).ciclo.reconstruir, 'hecho');

  const b = await f.call<Unit>('crear-unidad', { title: 'Recorridos' });
  intento(f.store, b.id, 'mirando', hace(5), { mirando: true });
  assert.equal((await leer(f, b)).ciclo.reconstruir, 'hecho', 'la regla del grupo pide un intento, no uno sin mirar');
});

test('el tutor registra el cierre de bloque en la unidad de la conversación o en la que indique', async t => {
  const f = await fixture(t);
  const unit = await conFuente(f, await unidad(f));
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 1 });
  await new Promise(r => setTimeout(r, 5));
  const sinUnidad = await f.herramienta('chat-suelto', 'estudio_cerrar_bloque').execute('c0', {});
  assert.equal(sinUnidad.isError, true);
  await f.call('contexto-conversacion', { chatId: 'chat-u', tipo: 'unidad', unitId: unit.id });
  const hecho = await f.herramienta('chat-u', 'estudio_cerrar_bloque').execute('c1', {});
  assert.deepEqual(hecho.details, { ok: true, unitId: unit.id });
  assert.equal((await leer(f, unit)).ciclo.reconstruir, 'hecho');

  const otra = await f.call<Unit>('crear-unidad', { title: 'Recorridos' });
  await f.herramienta('chat-suelto', 'estudio_cerrar_bloque').execute('c2', { unitId: otra.id });
  assert.equal((await leer(f, otra)).ciclo.reconstruir, 'hecho');
});

// ─── Mantener y usar ─────────────────────────────────────────────────────────

test('mantener y usar: sin intentos, sin empezar; en intervalo, hecho; con el repaso vencido o reaprendiendo, pendiente', async t => {
  const f = await fixture(t);
  const sin = await unidad(f);
  assert.equal((await leer(f, sin)).ciclo.mantener, 'vacio');

  const intervalo = await f.call<Unit>('crear-unidad', { title: 'Intervalo' });
  intento(f.store, intervalo.id, 'i1', hace(10), { graded: true });
  let u = await leer(f, intervalo);
  assert.equal(u.etapa.kind, 'intervalo');
  assert.equal(u.ciclo.mantener, 'hecho');

  const vencida = await f.call<Unit>('crear-unidad', { title: 'Vencida' });
  intento(f.store, vencida.id, 'v1', hace(60 * 24 * 10), { graded: true });
  u = await leer(f, vencida);
  assert.equal(u.etapa.kind, 'intervalo');
  assert.equal(u.ciclo.mantener, 'pendiente');

  const reaprende = await f.call<Unit>('crear-unidad', { title: 'Reaprende' });
  intento(f.store, reaprende.id, 'r1', hace(10), { graded: true, fidelity: 0 });
  u = await leer(f, reaprende);
  assert.equal(u.etapa.kind, 'reaprendiendo');
  assert.equal(u.ciclo.mantener, 'pendiente');
});

test('mantener y usar queda hecho en mantenimiento por uso', async t => {
  const f = await fixture(t);
  const unit = await unidad(f, { kind: 'procedimiento' });
  // Tres repasos completos, espaciados, con uso en dos casos aplicados distintos.
  intento(f.store, unit.id, 'm1', hace(60 * 24 * 30), { graded: true, kind: 'aplicada', use: 2, taskId: 'caso-1' });
  intento(f.store, unit.id, 'm2', hace(60 * 24 * 20), { graded: true, kind: 'aplicada', use: 2, taskId: 'caso-2' });
  intento(f.store, unit.id, 'm3', hace(60 * 24 * 10), { graded: true, kind: 'aplicada', use: 2, taskId: 'caso-1' });
  const u = await leer(f, unit);
  assert.equal(u.etapa.kind, 'mantenimiento');
  assert.equal(u.ciclo.mantener, 'hecho');
});

test('mantener y usar nunca queda pendiente para siempre: sin valorar o con «localizar» aún no hay repaso que mantener', async t => {
  const f = await fixture(t);
  const sinValorar = await unidad(f);
  intento(f.store, sinValorar.id, 's1', hace(10));
  let u = await leer(f, sinValorar);
  assert.equal(u.etapa.kind, 'nueva');
  assert.equal(u.ciclo.mantener, 'vacio');

  const localizar = await f.call<Unit>('crear-unidad', { title: 'Dónde está', policy: 'localizar' });
  intento(f.store, localizar.id, 'l1', hace(60 * 24 * 10), { graded: true });
  u = await leer(f, localizar);
  assert.equal(u.etapa.kind, 'fuera');
  assert.equal(u.ciclo.mantener, 'vacio');
});

// ─── Contexto de la conversación ─────────────────────────────────────────────

test('el contexto de la unidad lleva el volcado y pide partir de él; sin volcado, pide escribirlo al empezar', async t => {
  const f = await fixture(t);
  const unit = await unidad(f);
  type Contexto = { content: string; details: { lineas: string[] } };
  const sin = await f.call<Contexto>('contexto-conversacion', { chatId: 'chat-a', tipo: 'unidad', unitId: unit.id });
  assert.match(sin.content, /has not written his initial dump/);
  assert.match(sin.content, /Once the opening framing is settled, ask for his initial dump/);
  assert.ok(sin.details.lineas.includes('Sin volcado inicial: el tutor te lo pedirá al empezar.'));

  await f.call('guardar-volcado', { unitId: unit.id, texto: 'Creo que Dijkstra sirve con pesos negativos.' });
  const con = await f.call<Contexto>('contexto-conversacion', { chatId: 'chat-b', tipo: 'unidad', unitId: unit.id });
  assert.match(con.content, /His initial dump for this unit \(\d{4}-\d{2}-\d{2}\), written by him without AI/);
  assert.match(con.content, /> Creo que Dijkstra sirve con pesos negativos\./);
  assert.match(con.content, /Start from his initial dump: do not ask him for it again/);
  assert.doesNotMatch(con.content, /Your first question/);
  assert.ok(con.details.lineas.includes('Tu volcado inicial: Creo que Dijkstra sirve con pesos negativos.'));
});

// ─── Lector abierto desde una unidad (ticket 05) ─────────────────────────────

type Nota = { cuaderno: string; texto: string; cita: string; localizador: string };
const notasDe = async (f: Awaited<ReturnType<typeof fixture>>, unit: Unit) => (await f.call<{ notas: Nota[] }>('unidad', { id: unit.id })).notas;

test('un pasaje anotado desde una unidad queda en su página con la cita; desde la Biblioteca, no', async t => {
  const f = await fixture(t);
  const unit = await conFuente(f, await unidad(f));
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 4, quote: 'Dijkstra relaja cada arista una vez.', unitId: unit.id });
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 5, quote: 'Con pesos negativos falla.', unitId: unit.id });
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 6, quote: 'Leído sin unidad.' });
  const notas = await notasDe(f, unit);
  assert.deepEqual(notas.map(n => [n.cita, n.localizador, n.texto]), [
    ['Dijkstra relaja cada arista una vez.', 'p. 4', ''], ['Con pesos negativos falla.', 'p. 5', ''],
  ]);
  assert.equal(notas[0]!.cuaderno, 'Libro doc-1');
  // Lo anotado sin unidad va a la nota de fuente suelta del documento, no a la de la unidad.
  const sueltas = (await f.call<{ unitId: string | null; documentId: string | null; blocks: unknown[] }[]>('cuadernos'))
    .filter(nb => nb.documentId === 'doc-1' && nb.unitId === null);
  assert.equal(sueltas.length, 1);
  assert.equal(sueltas[0]!.blocks.length, 1);
});

test('anotar desde una unidad exige que exista; cada unidad tiene su propia nota de la misma fuente', async t => {
  const f = await fixture(t);
  const a = await conFuente(f, await unidad(f));
  const otra = await f.call<Unit>('crear-unidad', { title: 'Árboles', capability: 'Explicar Prim' });
  const b = await f.call<Unit>('vincular-documento', { unitId: otra.id, expectedRevision: otra.revision, documentId: 'doc-1' });
  await assert.rejects(async () => f.call('anotar-pasaje', { documentId: 'doc-1', page: 1, quote: 'x y z', unitId: 'nada' }), /unidad no existe/);
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 1, quote: 'Para A.', unitId: a.id });
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 2, quote: 'Para B.', unitId: b.id });
  assert.deepEqual((await notasDe(f, a)).map(n => n.cita), ['Para A.']);
  assert.deepEqual((await notasDe(f, b)).map(n => n.cita), ['Para B.']);
});

test('cerrar el lector con capturas nuevas desde la unidad deja la fuente trabajada y propone reconstruir', async t => {
  const f = await fixture(t);
  const unit = await conFuente(f, await unidad(f));
  await f.call('guardar-volcado', { unitId: unit.id, texto: 'Sé poco.' });
  await f.call('anotar-pasaje', { documentId: 'doc-1', page: 4, quote: 'Dijkstra relaja cada arista una vez.', unitId: unit.id });
  // Lo que hace el lector al cerrarse: una captura nueva en esta lectura.
  await f.call('registrar-fuente-trabajada', { unitId: unit.id, documentId: 'doc-1', capturas: 1 });
  const u = await leer(f, unit);
  assert.deepEqual(u.fuentes.map(x => [x.documentoId, x.capturas, x.reconstruida]), [['doc-1', 1, false]]);
  assert.equal(u.ciclo.exponer, 'hecho');
  assert.equal(u.ciclo.reconstruir, 'pendiente');
});
