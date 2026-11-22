import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import { createNotebookService } from '../src/notebooks/service.ts';
import { createMargen } from '../src/notebooks/margen.ts';
import { createPersonajes, lineasDePersona } from '../src/notebooks/personajes.ts';
import { createLibro } from '../src/notebooks/libro-proactivo.ts';
import { MARGIN_SYSTEM, THREAD_SYSTEM } from '../src/notebooks/margen-prompts.ts';
import { parseNotebook, type Comment } from '../src/notebooks/types.ts';
import type { SearchResult } from '../src/kb/search.ts';
import { tempStore, unit, NOW } from './study-fixtures.ts';
import { nombreEstudiante } from '../src/identidad.ts';

const TEXTO = 'Un embedding es un vector denso aprendido.';
const BLOCKS = [
  { id: 'b1', kind: 'nota', symbol: null, text: TEXTO, locator: '', quote: '' },
  { id: 'b2', kind: 'nota', symbol: '?', text: '¿Por qué no basta el one-hot?', locator: '', quote: '' },
];
const ANCLA = { blockId: 'b1', text: 'vector denso', start: 19, end: 31, prefix: 'Un embedding es un ', suffix: ' aprendido.' };
const SIN_HITS: SearchResult = { hits: [], relacionados: [], cobertura: { registros: 0, secciones: 0, conversaciones: 0, notas: 0, documentosNoListos: 0, coincidencias: 0, truncado: false }, vacio: 'sin_coincidencias' };

interface Llamada { model: unknown; purpose: string; systemPrompt: string; user: string }

function fixture(t: TestContext, { fuerte = true, respuesta = 'Pregunta tutor: ¿denso respecto a qué?', parada = 'stop' } = {}) {
  const store = tempStore(t);
  let n = 0;
  const ids = () => `id${++n}`;
  const llamadas: Llamada[] = [];
  const consultas: string[] = [];
  let hits: SearchResult = SIN_HITS;
  /** Lo que ocurre mientras el modelo piensa: David sigue escribiendo, descartando... */
  let durante: (() => void) | null = null;
  let texto = respuesta;
  const inference = {
    async catalog() { return { slots: fuerte ? { strong: { model: { provider: 'claude-code', id: 'opus' }, thinkingLevel: 'low' } } : {} }; },
    async complete(request: { model: unknown; purpose: string; context: { systemPrompt: string; messages: { content: string }[] } }) {
      llamadas.push({ model: request.model, purpose: request.purpose, systemPrompt: request.context.systemPrompt, user: request.context.messages.map(m => m.content).join('\n') });
      durante?.();
      if (parada === 'error') return { role: 'assistant', stopReason: 'error', errorMessage: 'caído', content: [] };
      return { role: 'assistant', stopReason: parada, content: [{ type: 'text', text: texto }] };
    },
  } as unknown as PluginInference;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-libro-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const personajes = createPersonajes(dir);
  const libro = createLibro(dir, { now: () => NOW, timeZone: 'Europe/Madrid' });
  const cuadernos = createNotebookService(store, { now: () => NOW, newId: ids });
  const margen = createMargen(store, { inference, signal: new AbortController().signal, now: () => NOW, newId: ids, buscar: q => { consultas.push(q); return hits; }, libro, personajes });
  const crear = (unitId: string | null = null) => {
    const nb = cuadernos.create({ title: 'Embeddings', kind: 'libre', ...(unitId ? { unitId } : {}) });
    return cuadernos.save({ id: nb.id, expectedRevision: 1, title: 'Embeddings', kind: 'libre', unitId, documentId: null, blocks: BLOCKS });
  };
  return { store, cuadernos, margen, llamadas, consultas, crear, setHits: (h: SearchResult) => { hits = h; },
    mientrasPiensa: (fn: (() => void) | null) => { durante = fn; }, responderCon: (t: string) => { texto = t; } };
}

test('a notebook without comments reads as before and keeps the field out of the record', t => {
  const f = fixture(t);
  const nb = f.crear();
  assert.equal('comments' in nb, false);
  assert.equal('comments' in parseNotebook(JSON.parse(JSON.stringify(nb))), false);
});

test('asking the tutor stores one comment in the notebook and never touches David\'s text', async t => {
  const f = fixture(t);
  const antes = f.crear();
  const out = await f.margen.comentar({ id: antes.id, anchor: ANCLA, kind: 'pregunta' });
  assert.deepEqual(out.blocks, antes.blocks);
  assert.equal(out.title, antes.title);
  assert.equal(out.revision, antes.revision + 1);
  const [c] = out.comments as Comment[];
  assert.equal(out.comments!.length, 1);
  assert.deepEqual([c!.kind, c!.state, c!.persona], ['pregunta', 'abierto', 'profesor']);
  assert.deepEqual(c!.anchor, ANCLA);
  assert.deepEqual(c!.thread.map(m => [m.role, m.text]), [['tutor', 'Pregunta tutor: ¿denso respecto a qué?']]);
  // Lo que se lee de nuevo es lo mismo.
  assert.deepEqual(f.cuadernos.list()[0]!.comments, out.comments);
});

test('the comment survives saving the page again, which only carries the blocks', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const out = await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'explicacion' });
  const guardado = f.cuadernos.save({ id: nb.id, expectedRevision: out.revision, title: 'Embeddings 2', kind: 'libre', unitId: null, documentId: null, blocks: [BLOCKS[0]] });
  assert.equal(guardado.comments!.length, 1);
  assert.equal(guardado.comments![0]!.kind, 'explicacion');
});

test('without a unit the model gets the notebook, the fragment and the request, and nothing about a unit', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' });
  const [l] = f.llamadas;
  assert.equal(f.llamadas.length, 1);
  assert.deepEqual(l!.model, { provider: 'claude-code', id: 'opus', thinkingLevel: 'low' });
  assert.equal(l!.purpose, 'user');
  assert.equal(l!.systemPrompt, MARGIN_SYSTEM);
  assert.equal(l!.user, [
    '[Notebook] Embeddings',
    lineasDePersona(createPersonajes(os.tmpdir()).resolver(undefined))[0],
    'Written by him, paragraph by paragraph:',
    `1. ${TEXTO}`,
    '2. ? ¿Por qué no basta el one-hot?',
    '',
    'The fragment he selected, in paragraph 1:',
    '«vector denso»',
    '',
    'His request: ask him questions about the selected fragment and point out what is missing in it.',
  ].join('\n'));
  assert.deepEqual(f.consultas, []);
});

test('with a unit the context adds its capability, criterion, initial dump and what the study search finds', async t => {
  const f = fixture(t);
  f.store.saveUnit(unit({ id: 'u1', title: 'Embeddings', capability: 'Explicar qué es un embedding', criterion: 'Lo explico sin mirar' }), null);
  f.store.saveHechos({ id: 'u1', revision: 1, hechos: [{ tipo: 'volcado', fecha: NOW, texto: 'Creo que son listas de números.', origen: 'pagina', chatId: null }] }, null);
  f.setHits({ ...SIN_HITS, vacio: null, hits: [
    { id: 'cuaderno:otro', kind: 'nota', title: 'Otro cuaderno', score: 3, snippet: 'Los vectores densos comprimen.' },
    { id: 'documento:d1#s1', kind: 'seccion', title: 'Manual › Embeddings', score: 2, locator: 'pdf:3', snippet: 'Dense representations.' },
  ] });
  const nb = f.crear('u1');
  await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'explicacion' });
  assert.deepEqual(f.consultas, ['vector denso']);
  const user = f.llamadas[0]!.user;
  for (const parte of [
    'Unit this notebook belongs to: «Embeddings»',
    'What he wants to be able to do: Explicar qué es un embedding',
    'How he will know he can: Lo explico sin mirar',
    'His initial dump for this unit',
    'Creo que son listas de números.',
    'What the study search found about the fragment:',
    '- Otro cuaderno (nota): Los vectores densos comprimen.',
    '- Manual › Embeddings (seccion, pdf:3): Dense representations.',
    'His request: explain the selected fragment',
  ]) assert.ok(user.includes(parte), `falta «${parte}» en:\n${user}`);
});

test('the search never returns the notebook itself as a hit', async t => {
  const f = fixture(t);
  f.store.saveUnit(unit({ id: 'u1' }), null);
  const nb = f.crear('u1');
  f.setHits({ ...SIN_HITS, vacio: null, hits: [{ id: `cuaderno:${nb.id}`, kind: 'nota', title: 'Embeddings', score: 5, snippet: 'ESTE-MISMO' }] });
  await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' });
  assert.equal(f.llamadas[0]!.user.includes('ESTE-MISMO'), false);
});

test('the instructions say the tutor never writes text to paste into the page', () => {
  assert.match(MARGIN_SYSTEM, /Never return text for him to paste into the page/);
  assert.match(MARGIN_SYSTEM, /Never rewrite, correct or complete his text/);
  assert.match(MARGIN_SYSTEM, /Spanish/);
});

test('without a strong model the error says so and the notebook is untouched', async t => {
  const f = fixture(t, { fuerte: false });
  const nb = f.crear();
  await assert.rejects(() => f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' }), /Configura el modelo fuerte en Ajustes para que el tutor comente/);
  assert.equal(f.llamadas.length, 0);
  assert.deepEqual(f.cuadernos.list()[0], nb);
});

test('a failed or empty model answer leaves no comment', async t => {
  const fallo = fixture(t, { parada: 'error' });
  const a = fallo.crear();
  await assert.rejects(() => fallo.margen.comentar({ id: a.id, anchor: ANCLA, kind: 'pregunta' }), /El modelo falló: caído/);
  assert.equal(fallo.cuadernos.list()[0]!.comments, undefined);
  const vacia = fixture(t, { respuesta: '   ' });
  const b = vacia.crear();
  await assert.rejects(() => vacia.margen.comentar({ id: b.id, anchor: ANCLA, kind: 'pregunta' }), /no devolvió ningún comentario/);
});

test('discarding persists: the comment stays in the record as discarded', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const con = await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' });
  const out = f.margen.descartar({ id: nb.id, commentId: con.comments![0]!.id });
  assert.equal(out.comments![0]!.state, 'descartado');
  assert.equal(f.cuadernos.list()[0]!.comments![0]!.state, 'descartado');
  assert.throws(() => f.margen.descartar({ id: nb.id, commentId: 'nada' }), /no existe/);
});

test('a malformed anchor is refused before calling the model', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await assert.rejects(() => f.margen.comentar({ id: nb.id, anchor: { ...ANCLA, text: '   ' }, kind: 'pregunta' }), /text/);
  await assert.rejects(() => f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'grafo' }), /kind/);
  await assert.rejects(() => f.margen.comentar({ id: nb.id, anchor: { ...ANCLA, blockId: 'otro' }, kind: 'pregunta' }), /no está guardado/);
  assert.equal(f.llamadas.length, 0);
});

test('at the limit the discarded comments make room and, if none can, the request is refused', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const viejo = (i: number, state: Comment['state']): Comment => ({ id: `c${i}`, anchor: ANCLA, persona: 'tutor', kind: 'pregunta', state, createdAt: NOW, thread: [{ id: `m${i}`, role: 'tutor', text: 'x', at: NOW }] });
  const llenar = (state: Comment['state']) => f.store.saveNotebook({ ...f.cuadernos.list()[0]!, revision: f.cuadernos.list()[0]!.revision + 1, comments: Array.from({ length: 200 }, (_, i) => viejo(i, state)) }, f.cuadernos.list()[0]!.revision);
  llenar('abierto');
  await assert.rejects(() => f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' }), /200 comentarios/);
  assert.equal(f.llamadas.length, 0, 'the cap is checked before paying for a call');
  const g = fixture(t);
  const nb2 = g.crear();
  g.store.saveNotebook({ ...g.cuadernos.list()[0]!, revision: nb2.revision + 1, comments: Array.from({ length: 200 }, (_, i) => viejo(i, 'descartado')) }, nb2.revision);
  const out = await g.margen.comentar({ id: nb2.id, anchor: ANCLA, kind: 'pregunta' });
  assert.equal(out.comments!.length, 1);
  assert.equal(out.comments![0]!.state, 'abierto');
});

/* ---- Hilos (ticket 12c) ---- */

async function conComentario(f: ReturnType<typeof fixture>, unitId: string | null = null) {
  const nb = f.crear(unitId);
  const con = await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' });
  return { nb: con, comentario: con.comments![0]! };
}

const roles = (f: ReturnType<typeof fixture>) => f.cuadernos.list()[0]!.comments![0]!.thread.map(m => m.role);

test('David\'s reply joins the thread, persists, calls no model and never touches the page', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  const out = f.margen.responder({ id: nb.id, commentId: comentario.id, text: '  Denso frente a one-hot.  ' });
  assert.deepEqual(out.blocks, nb.blocks);
  assert.equal(out.title, nb.title);
  assert.equal(out.revision, nb.revision + 1);
  assert.deepEqual(out.comments![0]!.thread.map(m => [m.role, m.text]), [['tutor', 'Pregunta tutor: ¿denso respecto a qué?'], ['david', 'Denso frente a one-hot.']]);
  assert.equal(f.llamadas.length, 1, 'only the first comment called the model');
  assert.deepEqual(f.cuadernos.list()[0]!.comments, out.comments);
});

test('a reply needs text, a live comment and room in the thread', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  assert.throws(() => f.margen.responder({ id: nb.id, commentId: comentario.id, text: '   ' }), /text/);
  assert.throws(() => f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'x'.repeat(8001) }), /text/);
  assert.throws(() => f.margen.responder({ id: nb.id, commentId: 'nada', text: 'hola' }), /no existe/);
  f.margen.descartar({ id: nb.id, commentId: comentario.id });
  assert.throws(() => f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'hola' }), /descartado/);
  const g = fixture(t);
  const { nb: nb2, comentario: c2 } = await conComentario(g);
  const lleno = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'david' as const : 'tutor' as const, text: 'x', at: NOW }));
  const actual = g.cuadernos.list()[0]!;
  g.store.saveNotebook({ ...actual, revision: actual.revision + 1, comments: [{ ...c2, thread: lleno }] }, actual.revision);
  assert.throws(() => g.margen.responder({ id: nb2.id, commentId: c2.id, text: 'hola' }), /lleno/);
});

test('the tutor answers in the thread with the strong model and the notebook plus the whole thread as context', async t => {
  const f = fixture(t);
  f.store.saveUnit(unit({ id: 'u1', title: 'Embeddings', capability: 'Explicar qué es un embedding' }), null);
  const { nb, comentario } = await conComentario(f, 'u1');
  f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Respecto a one-hot, creo.' });
  f.responderCon('Bien, ¿y qué ganas con ello?');
  const out = await f.margen.contestar({ id: nb.id, commentId: comentario.id });
  assert.equal(f.llamadas.length, 2);
  const l = f.llamadas[1]!;
  assert.deepEqual(l.model, { provider: 'claude-code', id: 'opus', thinkingLevel: 'low' });
  assert.equal(l.purpose, 'user');
  assert.equal(l.systemPrompt, THREAD_SYSTEM);
  for (const parte of [
    '[Notebook] Embeddings', 'What he wants to be able to do: Explicar qué es un embedding', `1. ${TEXTO}`,
    'The fragment he selected, in paragraph 1:', '«vector denso»',
    'Tutor: Pregunta tutor: ¿denso respecto a qué?', `${nombreEstudiante()}: Respecto a one-hot, creo.`,
  ]) assert.ok(l.user.includes(parte), `falta «${parte}» en:\n${l.user}`);
  assert.ok(l.user.trimEnd().endsWith('His latest message is the last one of the thread: answer it.'));
  assert.ok(l.user.indexOf('Tutor: Pregunta') < l.user.indexOf(`${nombreEstudiante()}: Respecto`), 'the thread goes in order');
  assert.deepEqual(out.comments![0]!.thread.map(m => [m.role, m.text]), [
    ['tutor', 'Pregunta tutor: ¿denso respecto a qué?'], ['david', 'Respecto a one-hot, creo.'], ['tutor', 'Bien, ¿y qué ganas con ello?'],
  ]);
  assert.deepEqual(out.blocks, nb.blocks);
  assert.equal(out.comments![0]!.state, 'abierto');
});

test('there is nothing to answer unless David spoke last', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  await assert.rejects(() => f.margen.contestar({ id: nb.id, commentId: comentario.id }), /nada que contestar/);
  assert.equal(f.llamadas.length, 1, 'refused before paying for a call');
});

test('a failed or empty answer leaves the thread as it was, with David\'s message in it', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Hola' });
  f.mientrasPiensa(() => { throw new Error('red caída'); });
  await assert.rejects(() => f.margen.contestar({ id: nb.id, commentId: comentario.id }), /red caída/);
  assert.deepEqual(roles(f), ['tutor', 'david']);
  f.mientrasPiensa(null);
  f.responderCon('   ');
  await assert.rejects(() => f.margen.contestar({ id: nb.id, commentId: comentario.id }), /no devolvió ninguna respuesta/);
  assert.deepEqual(roles(f), ['tutor', 'david']);
  f.responderCon('Ahora sí.');
  assert.deepEqual((await f.margen.contestar({ id: nb.id, commentId: comentario.id })).comments![0]!.thread.map(m => m.role), ['tutor', 'david', 'tutor'], 'it can be asked again');
});

test('an answer in flight is not lost when David edits the page meanwhile', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Sigo' });
  let guardado: ReturnType<typeof f.cuadernos.save> | null = null;
  f.mientrasPiensa(() => {
    const actual = f.cuadernos.list()[0]!;
    guardado = f.cuadernos.save({ id: nb.id, expectedRevision: actual.revision, title: 'Embeddings', kind: 'libre', unitId: null, documentId: null, blocks: [BLOCKS[0], { ...BLOCKS[1], text: '¿Por qué no basta el one-hot? Editado.' }] });
  });
  const out = await f.margen.contestar({ id: nb.id, commentId: comentario.id });
  assert.equal(out.comments![0]!.thread.length, 3);
  assert.equal((out.blocks[1] as { text: string }).text, '¿Por qué no basta el one-hot? Editado.', 'David\'s edit survives the answer');
  assert.equal(out.revision, guardado!.revision + 1);
  assert.deepEqual(f.cuadernos.list()[0], out);
});

test('an answer for a thread discarded or continued meanwhile is not written', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Uno' });
  f.mientrasPiensa(() => { f.margen.descartar({ id: nb.id, commentId: comentario.id }); });
  await assert.rejects(() => f.margen.contestar({ id: nb.id, commentId: comentario.id }), /descartado/);
  assert.deepEqual(roles(f), ['tutor', 'david']);
  const g = fixture(t);
  const { nb: nb2, comentario: c2 } = await conComentario(g);
  g.margen.responder({ id: nb2.id, commentId: c2.id, text: 'Uno' });
  g.mientrasPiensa(() => { g.mientrasPiensa(null); g.margen.responder({ id: nb2.id, commentId: c2.id, text: 'Dos' }); });
  await assert.rejects(() => g.margen.contestar({ id: nb2.id, commentId: c2.id }), /se movió mientras el tutor pensaba/);
  assert.deepEqual(g.cuadernos.list()[0]!.comments![0]!.thread.map(m => m.text).slice(1), ['Uno', 'Dos']);
});

test('going back to the note marks the comment as attended and keeps its thread; replying again reopens it', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Ya lo veo' });
  const hecho = f.margen.atender({ id: nb.id, commentId: comentario.id });
  assert.equal(hecho.comments![0]!.state, 'atendido');
  assert.equal(hecho.comments![0]!.thread.length, 2);
  assert.deepEqual(hecho.blocks, nb.blocks);
  assert.equal(f.cuadernos.list()[0]!.comments![0]!.state, 'atendido');
  assert.equal(f.margen.atender({ id: nb.id, commentId: comentario.id }).comments![0]!.state, 'atendido', 'attending twice is harmless');
  const otra = f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'Una duda más' });
  assert.equal(otra.comments![0]!.state, 'abierto');
  assert.equal(otra.comments![0]!.thread.length, 3);
});

test('a discarded comment cannot be attended, and attending an unknown one is refused', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  assert.throws(() => f.margen.atender({ id: nb.id, commentId: 'nada' }), /no existe/);
  f.margen.descartar({ id: nb.id, commentId: comentario.id });
  assert.throws(() => f.margen.atender({ id: nb.id, commentId: comentario.id }), /descartado/);
});

test('no operation of the thread changes the blocks', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  const ids = { id: nb.id, commentId: comentario.id };
  const pasos = [
    f.margen.responder({ ...ids, text: 'Uno' }), await f.margen.contestar(ids), f.margen.atender(ids),
    f.margen.responder({ ...ids, text: 'Dos' }), await f.margen.contestar(ids), f.margen.atender(ids),
  ];
  for (const p of pasos) assert.deepEqual(p.blocks, nb.blocks);
  assert.deepEqual(parseNotebook(JSON.parse(JSON.stringify(pasos.at(-1)))), pasos.at(-1));
});

test('a notebook whose comments have no thread beyond the first message reads as before', async t => {
  const f = fixture(t);
  const { nb } = await conComentario(f);
  assert.deepEqual(parseNotebook(JSON.parse(JSON.stringify(nb))).comments![0]!.thread.length, 1);
});

test('the thread instructions share the rules of the margin about his page', () => {
  assert.match(THREAD_SYSTEM, /Never return text for him to paste into the page/);
  assert.match(THREAD_SYSTEM, /Never rewrite, correct or complete his text/);
  assert.match(THREAD_SYSTEM, /the page is his and give him the ideas he needs/);
  assert.match(THREAD_SYSTEM, /goes back to the note and writes the conclusion himself/);
  assert.match(THREAD_SYSTEM, /Spanish/);
});

test('David cannot write the message the tutor would have no room to answer', async t => {
  const f = fixture(t);
  const { nb, comentario } = await conComentario(f);
  const actual = f.cuadernos.list()[0]!;
  const hilo = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'david' as const : 'tutor' as const, text: 'x', at: NOW }));
  f.store.saveNotebook({ ...actual, revision: actual.revision + 1, comments: [{ ...comentario, thread: hilo(98) }] }, actual.revision);
  assert.equal(f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'cabe' }).comments![0]!.thread.length, 99);
  assert.throws(() => f.margen.responder({ id: nb.id, commentId: comentario.id, text: 'ya no' }), /lleno/);
  assert.equal((await f.margen.contestar({ id: nb.id, commentId: comentario.id })).comments![0]!.thread.length, 100, 'the 99th message still gets its answer');
});

test('the margin prompt asks for about fifty words and keeps the closing question', () => {
  assert.match(MARGIN_SYSTEM, /about fifty words/);
  assert.doesNotMatch(MARGIN_SYSTEM, /eighty/);
  assert.match(MARGIN_SYSTEM, /end with the question/i);
});
