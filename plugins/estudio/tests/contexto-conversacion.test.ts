/**
 * Conversaciones con contexto (ticket 03, ADR 0003): la creación de conversaciones del núcleo pide a Estudio el
 * texto del contexto con el id de la conversación nueva. Estudio lo compone para una unidad, un pasaje o un intento,
 * y registra la conversación en su espacio y con su unidad, de modo que aparece en la lista del espacio y en la
 * página de la unidad. Se prueba con el plugin activado y sus operaciones llamadas por nombre.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginBackendContext } from 'learnharness-plugin-api';
import { activate } from '../src/backend.ts';
import { openStudyStore } from '../src/study/store.ts';
import { answerHash } from '../src/practice/schema.ts';

interface Chat { id: string; title: string; updatedAt: string; messages: number }
interface Contexto { content: string; details: { tipo: string; titulo: string; lineas: string[]; unidadId: string | null } }

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-contexto-'));
  const handlers = new Map<string, (input: unknown) => unknown>();
  const instructions: { text: unknown }[] = [];
  const chats = new Map<string, Chat>();
  const listeners: ((event: { type: string }) => void)[] = [];
  const emitted: string[] = [];
  const ctx = {
    dataDirectory: path.join(root, 'data'), signal: new AbortController().signal,
    cleanup() {},
    handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
    events: { emit(topic: string) { emitted.push(topic); }, on(l: (event: { type: string }) => void) { listeners.push(l); return () => {}; } },
    learning: {
      getSession: (id: string) => {
        const c = chats.get(id);
        return c ? { id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, messages: [] } : null;
      },
      listSessions: () => [...chats.values()].map(c => ({ id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, kind: 'teach', messageCount: c.messages, busy: false })),
    },
    registerInstructions(i: { text: unknown }) { instructions.push(i); return () => {}; },
    registerTools() { return () => {}; },
    inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error('sin modelo en estas pruebas'); } },
  } as unknown as PluginBackendContext;
  const stop = await activate(ctx);
  const store = openStudyStore(path.join(ctx.dataDirectory, 'study'));
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = async <T>(name: string, input?: unknown) => await handlers.get(name)!(input) as T;
  /** Lo que hace el núcleo: crea la conversación (con el mensaje de contexto, que cuenta como mensaje) y pide el contexto. */
  const abrir = async (chatId: string, studyContext: Record<string, unknown>) => {
    const contexto = await call<Contexto>('contexto-conversacion', { chatId, ...studyContext });
    chats.set(chatId, { id: chatId, title: contexto.details.titulo, updatedAt: new Date().toISOString(), messages: 1 });
    return contexto;
  };
  const briefing = instructions.find(i => typeof i.text === 'function')!.text as (c: { chatId: string; agent: string }) => string;
  /** Lo que hace el núcleo al borrar: la conversación desaparece y avisa de que la lista cambió. */
  const borrar = (chatId: string) => { chats.delete(chatId); listeners.forEach(l => l({ type: 'chats-changed' })); };
  /** Una conversación que el núcleo crea sin contexto de estudio, con su primer mensaje de David. */
  const chatsSinContexto = (chatId: string) => { chats.set(chatId, { id: chatId, title: chatId, updatedAt: new Date().toISOString(), messages: 1 }); };
  return { call, store, abrir, briefing, borrar, chatsSinContexto, emitted, ctx };
}

async function espacioConUnidad(f: Awaited<ReturnType<typeof fixture>>) {
  const fis = await f.call<{ id: string }>('crear-espacio', { name: 'Física' });
  const unidad = await f.call<{ id: string }>('crear-unidad', { title: 'Leyes de Newton', capability: 'Resolver problemas de dinámica', criterion: 'Sin mirar el libro' });
  return { fis, unidad };
}

function documento(f: Awaited<ReturnType<typeof fixture>>, id: string, title: string, areaId: string | null) {
  f.store.saveDocument({
    id, revision: 1, title, path: `C:/${id}.pdf`, status: 'listo', error: null, startedAt: '2026-11-01T10:00:00.000Z', finishedAt: '2026-11-01T10:01:00.000Z',
    original: { sha256: 'a'.repeat(64), bytes: 10 }, doclingSha256: null, estructuraSha256: 'b'.repeat(64), paginas: 12, contraste: null, revisar: [], areaId,
  }, null);
}

test('una unidad da su capacidad, criterio, etapa e historia, y la conversación queda en su espacio y en su página', async t => {
  const f = await fixture(t);
  const { fis, unidad } = await espacioConUnidad(f);
  const c = await f.abrir('chat-u', { tipo: 'unidad', unitId: unidad.id });
  assert.match(c.content, /^\[Study context\] — the learner opened this conversation from the unit «Leyes de Newton»/);
  assert.match(c.content, /What he wants to be able to do: Resolver problemas de dinámica\nHow he will know he can: Sin mirar el libro/);
  assert.match(c.content, /Stage: .*\nStudy cycle: orient pending; expose and capture not started/);
  // The framing comes first (ticket 07 of the second UX round); the dump, once it is settled.
  assert.match(c.content, /No attempts yet\.[\s\S]*Once the opening framing is settled, ask for his initial dump/);
  assert.doesNotMatch(c.content, /before anything else/);
  assert.deepEqual(c.details.tipo, 'unidad');
  assert.equal(c.details.unidadId, unidad.id);
  assert.ok(c.details.lineas.includes('Capacidad: Resolver problemas de dinámica'));

  // En el espacio activo y vinculada a la unidad: la lista del espacio y la página de la unidad la muestran.
  const lista = await f.call<{ id: string; areaId: string | null; links: { id: string }[] }[]>('conversaciones');
  assert.deepEqual(lista.map(x => [x.id, x.areaId, x.links.map(l => l.id)]), [['chat-u', fis.id, [unidad.id]]]);
  const lectura = await f.call<{ conversaciones: { id: string }[] }>('unidad', { id: unidad.id });
  assert.deepEqual(lectura.conversaciones.map(x => x.id), ['chat-u']);
});

test('la conversación se queda en el espacio de su unidad aunque luego cambie el espacio activo', async t => {
  const f = await fixture(t);
  const { fis, unidad } = await espacioConUnidad(f);
  await f.abrir('chat-u', { tipo: 'unidad', unitId: unidad.id });
  const mat = await f.call<{ id: string }>('crear-espacio', { name: 'Matemáticas' });
  assert.deepEqual((await f.call<unknown[]>('conversaciones')).length, 0, 'Matemáticas está activo: la conversación no es suya');
  // El resumen de arranque del primer turno es el del espacio de la conversación, no el del activo.
  assert.match(f.briefing({ chatId: 'chat-u', agent: 'teacher' }), /Study space: «Física»/);
  await f.call('activar-espacio', { areaId: fis.id });
  assert.deepEqual((await f.call<{ id: string }[]>('conversaciones')).map(x => x.id), ['chat-u']);
  assert.notEqual(mat.id, fis.id);
});

test('un pasaje da documento, página y cita, y se vincula a la unidad desde la que se leía', async t => {
  const f = await fixture(t);
  const { fis, unidad } = await espacioConUnidad(f);
  documento(f, 'doc-1', 'Principia', fis.id);
  const c = await f.abrir('chat-p', { tipo: 'pasaje', documentId: 'doc-1', page: 4, quote: 'Todo cuerpo persevera\nen su estado de reposo', unitId: unidad.id });
  assert.match(c.content, /passage of «Principia», page 4:\n> Todo cuerpo persevera\n> en su estado de reposo\nHe was reading it while studying the unit «Leyes de Newton»\./);
  assert.match(c.content, /in his own words; cite the page/);
  assert.deepEqual(c.details, { tipo: 'pasaje', titulo: 'Principia, p. 4', lineas: ['Todo cuerpo persevera\nen su estado de reposo', 'Unidad: Leyes de Newton'], unidadId: unidad.id });
  const lectura = await f.call<{ conversaciones: { id: string }[] }>('unidad', { id: unidad.id });
  assert.deepEqual(lectura.conversaciones.map(x => x.id), ['chat-p']);

  // Sin unidad, la conversación queda en el espacio del documento y sin vínculo.
  const solo = await f.abrir('chat-p2', { tipo: 'pasaje', documentId: 'doc-1', page: 1, quote: 'Definiciones' });
  assert.equal(solo.details.unidadId, null);
  const lista = await f.call<{ id: string; areaId: string | null; links: unknown[] }[]>('conversaciones');
  assert.deepEqual(lista.find(x => x.id === 'chat-p2')?.areaId, fis.id);
  assert.deepEqual(lista.find(x => x.id === 'chat-p2')?.links, []);
});

test('un intento terminado da la respuesta congelada y el contraste, y se vincula a su unidad', async t => {
  const f = await fixture(t);
  const { unidad } = await espacioConUnidad(f);
  f.store.saveTask({ id: 't1', revision: 1, unitId: unidad.id, kind: 'libre', prompt: 'Enuncia la segunda ley', cues: ['1', '2', '3', '4', '5'], reference: 'F = m·a', rubric: ['Relaciona fuerza y aceleración'], createdAt: '2026-11-10T10:00:00.000Z', model: { provider: 'p', id: 'm' } }, null);
  const attempt = (id: string, status: 'open' | 'graded') => f.store.saveAttempt({
    id, revision: 1, unitId: unidad.id, taskId: 't1', taskKind: 'libre', openedAt: '2026-11-10T10:00:00.000Z', confidence: 60,
    cueLevel: 0, cueLevelAtFreeze: status === 'open' ? null : 0, answer: 'La fuerza es masa por velocidad', answerHash: status === 'open' ? null : answerHash('La fuerza es masa por velocidad'),
    frozenAt: status === 'open' ? null : '2026-11-10T10:05:00.000Z', status, contextLabel: 'libre',
    judgments: status === 'open' ? [] : [{ fidelity: 1, failureType: 'precision', rationale: 'Confunde velocidad con aceleración.', judgedAt: '2026-11-10T10:06:00.000Z', model: { provider: 'p', id: 'm' } }],
    grades: status === 'open' ? [] : [{ fidelity: 1, use: null, failureType: 'precision', gradedAt: '2026-11-10T10:07:00.000Z', correction: false }],
  }, null);
  attempt('a-hecho', 'graded');
  attempt('a-abierto', 'open');

  const c = await f.abrir('chat-i', { tipo: 'intento', attemptId: 'a-hecho' });
  assert.match(c.content, /finished retrieval attempt on the unit «Leyes de Newton» \(2026-11-10\)/);
  assert.match(c.content, /Task \(libre\): Enuncia la segunda ley\nHis answer, frozen before he saw the contrast:\n> La fuerza es masa por velocidad\nReference:\n> F = m·a\nRubric:\n- Relaciona fuerza y aceleración/);
  assert.match(c.content, /Model's contrast: fidelity 1\/3, failure precision\. Confunde velocidad con aceleración\.\nHis own grade: fidelity 1\/3/);
  assert.equal(c.details.unidadId, unidad.id);
  const lectura = await f.call<{ conversaciones: { id: string }[] }>('unidad', { id: unidad.id });
  assert.deepEqual(lectura.conversaciones.map(x => x.id), ['chat-i']);

  // El contexto de la unidad resume ese intento; la tarjeta, en español.
  const u = await f.abrir('chat-u2', { tipo: 'unidad', unitId: unidad.id });
  assert.match(u.content, /- 2026-11-10 libre, graded, fidelity 1\/3/);
  assert.ok(u.details.lineas.some(l => /^Intento 2026-11-10 libre, valorado, fidelidad 1\/3$/.test(l)), u.details.lineas.join(' | '));

  await assert.rejects(async () => f.abrir('chat-x', { tipo: 'intento', attemptId: 'a-abierto' }), /intento terminado/);
});

test('un contexto inválido no registra nada', async t => {
  const f = await fixture(t);
  const { unidad } = await espacioConUnidad(f);
  await f.call('archivar-unidad', { id: unidad.id, expectedRevision: 1 });
  await assert.rejects(async () => f.abrir('c1', { tipo: 'unidad', unitId: unidad.id }), /unidades activas/);
  await assert.rejects(async () => f.abrir('c2', { tipo: 'pasaje', documentId: 'no-existe', page: 1, quote: 'x' }), /no está disponible/);
  await assert.rejects(async () => f.abrir('c3', { tipo: 'grafo' }), /tipo/);
  assert.equal(f.store.listConversations().length, 0);
});

test('borrar la conversación manda su registro a la papelera: ni la unidad ni el espacio la conservan (ticket 12)', async t => {
  const f = await fixture(t);
  const { unidad } = await espacioConUnidad(f);
  await f.abrir('chat-u', { tipo: 'unidad', unitId: unidad.id });
  await f.abrir('chat-otra', { tipo: 'unidad', unitId: unidad.id });
  assert.equal(f.store.getConversation('chat-u')?.unitId, unidad.id);

  f.emitted.length = 0;
  f.borrar('chat-u');
  assert.equal(f.store.getConversation('chat-u'), null, 'sin registro, nada queda vinculado a la unidad');
  assert.equal(f.store.getConversation('chat-otra')?.unitId, unidad.id, 'las demás no se tocan');
  const papelera = path.join(f.ctx.dataDirectory, 'study', 'conversations', '.papelera');
  assert.deepEqual(fs.readdirSync(papelera).map(n => n.replace(/-\d+\.json$/, '')), ['chat-u']);
  const lectura = await f.call<{ conversaciones: { id: string }[] }>('unidad', { id: unidad.id });
  assert.deepEqual(lectura.conversaciones.map(x => x.id), ['chat-otra']);
  assert.deepEqual((await f.call<{ id: string }[]>('conversaciones')).map(x => x.id), ['chat-otra']);
  assert.ok(f.emitted.length > 0, 'avisa a las vistas para que relean');

  // Otro cambio de la lista (crear, renombrar) no borra nada ni avisa en vano.
  f.emitted.length = 0;
  f.borrar('no-existe');
  assert.equal(f.emitted.length, 0);
});

test('al activarse, Estudio olvida las conversaciones borradas mientras no estaba activo', async t => {
  const f = await fixture(t);
  const { unidad } = await espacioConUnidad(f);
  await f.abrir('chat-u', { tipo: 'unidad', unitId: unidad.id });
  // Un registro cuya conversación ya no existe, como si se hubiera borrado con Estudio parado.
  f.store.saveConversation({ ...f.store.getConversation('chat-u')!, id: 'chat-huerfana', revision: 1 }, null);
  const stop = await activate(f.ctx);
  t.after(async () => { await stop(); });
  assert.equal(f.store.getConversation('chat-huerfana'), null);
  assert.equal(f.store.getConversation('chat-u')?.unitId, unidad.id);
});

// Origen de la conversación (ticket 03 de la segunda ronda): se escribe al crearla y la lista lo da con su unidad.
type Fila = { id: string; origen: string; unidad: { id: string; titulo: string } | null; plan: { id: string; objetivo: string } | null };

test('cada conversación nueva guarda su origen: unidad, pasaje, intento o libre', async t => {
  const f = await fixture(t);
  const { fis, unidad } = await espacioConUnidad(f);
  documento(f, 'doc-1', 'Principia', fis.id);
  f.store.saveTask({ id: 't1', revision: 1, unitId: unidad.id, kind: 'libre', prompt: 'Enuncia la segunda ley', cues: ['1', '2', '3', '4', '5'], reference: 'F = m·a', rubric: ['Relaciona fuerza y aceleración'], createdAt: '2026-11-10T10:00:00.000Z', model: { provider: 'p', id: 'm' } }, null);
  f.store.saveAttempt({
    id: 'a1', revision: 1, unitId: unidad.id, taskId: 't1', taskKind: 'libre', openedAt: '2026-11-10T10:00:00.000Z', confidence: 60,
    cueLevel: 0, cueLevelAtFreeze: 0, answer: 'F = m·a', answerHash: answerHash('F = m·a'), frozenAt: '2026-11-10T10:05:00.000Z', status: 'frozen', contextLabel: 'libre',
    judgments: [], grades: [],
  }, null);

  await f.abrir('chat-u', { tipo: 'unidad', unitId: unidad.id });
  await f.abrir('chat-p', { tipo: 'pasaje', documentId: 'doc-1', page: 2, quote: 'Definiciones' });
  await f.abrir('chat-i', { tipo: 'intento', attemptId: 'a1' });
  // Una conversación sin contexto: el núcleo la crea sin avisar; Estudio la registra en su primer turno.
  f.chatsSinContexto('chat-l');
  f.briefing({ chatId: 'chat-l', agent: 'teacher' });

  assert.deepEqual(
    ['chat-u', 'chat-p', 'chat-i', 'chat-l'].map(id => f.store.getConversation(id)?.origen),
    ['unidad', 'pasaje', 'intento', 'libre'],
  );
  const lista = await f.call<Fila[]>('conversaciones');
  const de = (id: string) => lista.find(x => x.id === id)!;
  assert.deepEqual([de('chat-u').origen, de('chat-p').origen, de('chat-i').origen, de('chat-l').origen], ['unidad', 'pasaje', 'intento', 'libre']);
  assert.deepEqual(de('chat-i').unidad, { id: unidad.id, titulo: 'Leyes de Newton' });
  assert.equal(de('chat-p').unidad, null);
  assert.equal(de('chat-l').unidad, null);
});

test('una conversación antigua sin origen se lee como de unidad si tiene unidad y como libre si no, sin reescribirla', async t => {
  const f = await fixture(t);
  const { fis, unidad } = await espacioConUnidad(f);
  const dir = path.join(f.ctx.dataDirectory, 'study', 'conversations');
  fs.mkdirSync(dir, { recursive: true });
  const antiguo = (id: string, unitId: string | null) => {
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      id, revision: 1, briefing: '', briefedAt: '2026-10-01T10:00:00.000Z', summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId: fis.id, unitId,
    }));
    f.chatsSinContexto(id);
  };
  antiguo('vieja-u', unidad.id);
  antiguo('vieja-l', null);
  const lista = await f.call<Fila[]>('conversaciones');
  assert.deepEqual(lista.map(x => [x.id, x.origen, x.unidad?.titulo ?? null]).sort(), [['vieja-l', 'libre', null], ['vieja-u', 'unidad', 'Leyes de Newton']]);
  // Su primer turno tras la actualización no le inventa origen: sigue sin él en disco.
  f.briefing({ chatId: 'vieja-l', agent: 'teacher' });
  assert.equal(f.store.getConversation('vieja-l')?.origen, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'vieja-u.json'), 'utf8')).origen, undefined);

  // Registrada con su unidad antes del origen y aún sin primer turno: tampoco se le escribe uno al llegar este.
  fs.writeFileSync(path.join(dir, 'sin-turno.json'), JSON.stringify({
    id: 'sin-turno', revision: 1, briefing: null, briefedAt: null, summary: null, summaryOf: null, summarizedAt: null, summaryError: null, areaId: fis.id, unitId: unidad.id,
  }));
  f.chatsSinContexto('sin-turno');
  f.briefing({ chatId: 'sin-turno', agent: 'teacher' });
  assert.equal(f.store.getConversation('sin-turno')?.origen, null);
  assert.equal((await f.call<Fila[]>('conversaciones')).find(x => x.id === 'sin-turno')?.origen, 'unidad');
});

test('la lista da el plan de la unidad: el que la incluye o, fuera de él, el del espacio de la unidad', async t => {
  const f = await fixture(t);
  const { unidad } = await espacioConUnidad(f);
  const plan = await f.call<{ id: string }>('crear-plan', { goal: 'Mecánica clásica' });
  const fuera = await f.call<{ id: string }>('crear-unidad', { title: 'Rozamiento', capability: 'Calcular rozamientos', criterion: 'Sin mirar' });
  const propuesta = await f.call<{ id: string }>('proponer-cambio', { ops: [{ op: 'add', unitId: unidad.id }] });
  await f.call('aplicar-propuesta', { id: propuesta.id });
  await f.abrir('chat-dentro', { tipo: 'unidad', unitId: unidad.id });
  await f.abrir('chat-fuera', { tipo: 'unidad', unitId: fuera.id });
  f.chatsSinContexto('chat-libre');
  f.briefing({ chatId: 'chat-libre', agent: 'teacher' });
  const lista = await f.call<Fila[]>('conversaciones');
  assert.deepEqual(lista.map(x => [x.id, x.plan]).sort(), [
    ['chat-dentro', { id: plan.id, objetivo: 'Mecánica clásica' }],
    ['chat-fuera', { id: plan.id, objetivo: 'Mecánica clásica' }],
    ['chat-libre', null],
  ]);
});
