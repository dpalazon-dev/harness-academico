import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import { createDocumentService, documentConfig } from '../src/documents/incorporar.ts';
import { createKbService } from '../src/kb/service.ts';
import { leerPorDecidir } from '../src/inicio.ts';
import { openStudyStore } from '../src/study/store.ts';
import type { SearchResult } from '../src/kb/search.ts';
import { createAceptacion } from '../src/notebooks/aceptar.ts';
import { createLibro } from '../src/notebooks/libro-proactivo.ts';
import { createMargen } from '../src/notebooks/margen.ts';
import { createPersonajes } from '../src/notebooks/personajes.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import type { Comment, Notebook, Propuesta } from '../src/notebooks/types.ts';
import { ORIGINAL_SHA, tempAlmacen } from './documents-fixtures.ts';
import { fakeKbol, tempKb } from './kb-fixtures.ts';
import { NOW, tempStore, unit } from './study-fixtures.ts';

const CITA = 'water treatment plants is hard';
const BLOCKS = [
  { id: 'b1', kind: 'nota', symbol: null, text: 'Detectar anomalías en el agua es difícil.', locator: 'p. 1', quote: CITA },
  { id: 'b2', kind: 'nota', symbol: null, text: 'Un embedding es un vector denso.', locator: '', quote: '' },
  { id: 'b3', kind: 'nota', symbol: null, text: 'Tercer párrafo.', locator: '', quote: '' },
];
const ANCLA = (blockId: string, text: string, start: number) => ({ blockId, text, start, end: start + text.length, prefix: '', suffix: '' });
const SIN_HITS: SearchResult = { hits: [], relacionados: [], cobertura: { registros: 0, secciones: 0, conversaciones: 0, notas: 0, documentosNoListos: 0, coincidencias: 0, truncado: false }, vacio: 'sin_coincidencias' };
const etiqueta = (o: unknown) => `<propuestas>${JSON.stringify(o)}</propuestas>`;
const PREGUNTA = { pregunta: '¿Por qué es difícil detectar anomalías en agua?', respuesta: 'Porque los fallos son raros y los datos, ruidosos.' };
const HECHO = { afirmacion: 'Detectar anomalías en plantas de tratamiento de agua es difícil.' };

async function fixture(t: TestContext, respuesta = `¿Difícil respecto a qué?\n${etiqueta({ recuperacion: PREGUNTA, hecho: HECHO, conexion: { tipo: 'unidad', id: 'u2', motivo: 'Comparten el gradiente.' } })}`) {
  fakeKbol(t);
  const { almacen, estructuraSha } = tempAlmacen(t);
  const store = tempStore(t);
  store.saveDocument({
    id: 'd1', revision: 1, title: 'GDN paper', path: 'C:/p.pdf', status: 'listo', error: null, startedAt: NOW, finishedAt: NOW,
    original: { sha256: ORIGINAL_SHA, bytes: 22 }, doclingSha256: null, estructuraSha256: estructuraSha, paginas: 2, contraste: { recuerdo: 0.99, respaldo: 0.99, paginasSinTexto: [] }, revisar: [], areaId: null,
  } as never, null);
  store.saveUnit(unit({ id: 'u1', title: 'Anomalías' }), null);
  store.saveUnit(unit({ id: 'u2', title: 'Gradiente' }), null);
  store.saveUnit(unit({ id: 'u3', title: 'Archivada', status: 'archivada' }), null);
  const documents = createDocumentService(store, { config: { ...documentConfig({} as NodeJS.ProcessEnv), almacen }, now: () => NOW, newId: () => 'x', signal: new AbortController().signal, onChange: () => {} });
  const repo = await tempKb(t);
  const kb = createKbService(store, repo, documents, () => NOW);
  let n = 0;
  const ids = () => `id${++n}`;
  let texto = respuesta;
  const llamadas: { user: string; system: string }[] = [];
  const inference = {
    async catalog() { return { slots: { strong: { model: { provider: 'claude-code', id: 'opus' } }, cheap: { model: { provider: 'claude-code', id: 'sonnet' } } } }; },
    async complete(r: { context: { systemPrompt: string; messages: { content: string }[] } }) {
      llamadas.push({ system: r.context.systemPrompt, user: r.context.messages.map(m => m.content).join('\n') });
      return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: texto }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
    },
  } as unknown as PluginInference;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-prop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cuadernos = createNotebookService(store, { now: () => NOW, newId: ids });
  const margen = createMargen(store, { inference, signal: new AbortController().signal, now: () => NOW, newId: ids, buscar: () => SIN_HITS, libro: createLibro(dir, { now: () => NOW, timeZone: 'Europe/Madrid' }), personajes: createPersonajes(dir) });
  const aceptacion = createAceptacion(store, { kb, now: () => NOW, newId: ids });
  const crear = (titulo = 'Anomalías en agua') => {
    const nb = cuadernos.create({ title: titulo, kind: 'libre', unitId: 'u1', documentId: 'd1' });
    return cuadernos.save({ id: nb.id, expectedRevision: 1, title: titulo, kind: 'libre', unitId: 'u1', documentId: 'd1', blocks: BLOCKS });
  };
  return { store, kb, margen, aceptacion, cuadernos, crear, llamadas, responderCon: (x: string) => { texto = x; } };
}

const propuestasDe = (nb: Notebook): Propuesta[] => nb.comments?.[0]?.propuestas ?? [];
const de = (nb: Notebook, tipo: Propuesta['tipo']) => propuestasDe(nb).find(p => p.tipo === tipo)!;

test('the reply carries proposals: the comment is clean text, the page is untouched and the proposals wait as pending', async t => {
  const f = await fixture(t);
  const antes = f.crear();
  const out = await f.margen.comentar({ id: antes.id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
  assert.deepEqual(out.blocks, antes.blocks);
  const [c] = out.comments as Comment[];
  assert.deepEqual(c!.thread.map(m => m.text), ['¿Difícil respecto a qué?']);
  assert.deepEqual(propuestasDe(out).map(p => [p.tipo, p.estado]), [['recuperacion', 'pendiente'], ['hecho', 'pendiente'], ['conexion', 'pendiente']]);
  const hecho = de(out, 'hecho') as Extract<Propuesta, { tipo: 'hecho' }>;
  assert.deepEqual([hecho.documentId, hecho.pagina, hecho.cita], ['d1', 1, CITA]);
  assert.equal(f.kb.drafts().length, 0, 'offering a fact drafts nothing');
});

test('a malformed proposal shows the comment as plain text and breaks nothing', async t => {
  const f = await fixture(t, '¿Difícil respecto a qué?\n<propuestas>{"recuperacion": {"pregunta": </propuestas>');
  const out = await f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
  assert.deepEqual(out.comments![0]!.thread.map(m => m.text), ['¿Difícil respecto a qué?']);
  assert.equal('propuestas' in out.comments![0]!, false);
});

test('a reply with only the proposals has no comment: it fails like an empty reply', async t => {
  const f = await fixture(t, etiqueta({ recuperacion: PREGUNTA }));
  await assert.rejects(f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' }), /no devolvió ningún comentario/);
});

test('a fact is not offered on a paragraph that does not quote his source; a connection to an unknown or archived unit is not offered', async t => {
  const f = await fixture(t, `Algo.\n${etiqueta({ hecho: HECHO, conexion: { tipo: 'unidad', id: 'u3', motivo: 'x' } })}`);
  const out = await f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b2', 'vector denso', 20), kind: 'pregunta' });
  assert.equal('propuestas' in out.comments![0]!, false);
  f.responderCon(`Algo.\n${etiqueta({ conexion: { tipo: 'cuaderno', id: 'no-existe', motivo: 'x' } })}`);
  const otra = await f.margen.comentar({ id: out.id, anchor: ANCLA('b2', 'vector denso', 20), kind: 'explicacion' });
  assert.equal('propuestas' in otra.comments![1]!, false);
});

test('the context tells the model what it may connect to and when a fact is possible, and not otherwise', async t => {
  const f = await fixture(t, 'Pregunta.');
  const nb = f.crear('Primero');
  f.crear('Segundo');
  await f.margen.comentar({ id: nb.id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
  await f.margen.comentar({ id: nb.id, anchor: ANCLA('b2', 'vector denso', 20), kind: 'pregunta' });
  const [conCita, sinCita] = f.llamadas.map(l => l.user);
  assert.match(conCita!, /quotes page 1 of his source/);
  assert.doesNotMatch(sinCita!, /quotes page/);
  assert.match(conCita!, /unidad u2: «Gradiente»/);
  assert.doesNotMatch(conCita!, /u3/, 'archived units are not offered');
  assert.doesNotMatch(conCita!, /unidad u1/, 'the unit of the notebook is already its own');
  assert.match(conCita!, /cuaderno id\d+: «Segundo»/);
  assert.doesNotMatch(conCita!, new RegExp(`cuaderno ${nb.id}:`), 'the notebook is not offered to itself');
});

test('the thread can add proposals to its comment, with the cap of one pending of each kind', async t => {
  const f = await fixture(t);
  const hecho = await f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
  const c = hecho.comments![0]!;
  f.margen.responder({ id: hecho.id, commentId: c.id, text: 'No lo veo.' });
  f.responderCon(`Mira esto.\n${etiqueta({ recuperacion: { pregunta: '¿Otra?', respuesta: 'Otra.' }, hecho: { afirmacion: 'Una afirmación distinta.' } })}`);
  const out = await f.margen.contestar({ id: hecho.id, commentId: c.id });
  const lista = out.comments![0]!.propuestas!;
  assert.deepEqual(lista.map(p => `${p.tipo}:${p.estado}`), ['recuperacion:pendiente', 'hecho:pendiente', 'conexion:pendiente'], 'the three of the first answer are still pending: nothing new fits');
  assert.equal(out.comments![0]!.thread.at(-1)!.text, 'Mira esto.');
});

test('after one is decided the thread can offer a new one of that kind', async t => {
  const f = await fixture(t);
  const nb = await f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
  const c = nb.comments![0]!;
  await f.aceptacion.descartar({ id: nb.id, commentId: c.id, propuestaId: de(nb, 'recuperacion').id });
  f.margen.responder({ id: nb.id, commentId: c.id, text: 'Otra, por favor.' });
  f.responderCon(`Vale.\n${etiqueta({ recuperacion: { pregunta: '¿Otra distinta?', respuesta: 'Distinta.' } })}`);
  const out = await f.margen.contestar({ id: nb.id, commentId: c.id });
  assert.deepEqual(out.comments![0]!.propuestas!.map(p => `${p.tipo}:${p.estado}`), ['recuperacion:descartada', 'hecho:pendiente', 'conexion:pendiente', 'recuperacion:pendiente']);
});

test('the proactive read takes proposals from the "propuestas" key of its answer', async t => {
  const f = await fixture(t, JSON.stringify({ fragment: 'es difícil', comment: '¿Difícil respecto a qué?', propuestas: { recuperacion: PREGUNTA, hecho: HECHO } }));
  const nb = f.crear();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b1' });
  assert.equal(out.resultado, 'comentado');
  assert.deepEqual(propuestasDe(out.cuaderno).map(p => p.tipo), ['recuperacion', 'hecho']);
  assert.deepEqual(out.cuaderno.blocks, nb.blocks);
});

test('the proactive silence carries no proposals even if the model wrote some', async t => {
  const f = await fixture(t, JSON.stringify({ fragment: null, comment: null, propuestas: { recuperacion: PREGUNTA } }));
  const out = await f.margen.leer({ id: f.crear().id, blockId: 'b1' });
  assert.equal(out.resultado, 'sin-comentario');
  assert.equal(out.cuaderno.comments, undefined);
});

/* ---------- Accepting and discarding ---------- */

const aceptar = (f: Awaited<ReturnType<typeof fixture>>, nb: Notebook, tipo: Propuesta['tipo']) => f.aceptacion.aceptar({ id: nb.id, commentId: nb.comments![0]!.id, propuestaId: de(nb, tipo).id });
const descartar = (f: Awaited<ReturnType<typeof fixture>>, nb: Notebook, tipo: Propuesta['tipo']) => f.aceptacion.descartar({ id: nb.id, commentId: nb.comments![0]!.id, propuestaId: de(nb, tipo).id });
async function conPropuestas(f: Awaited<ReturnType<typeof fixture>>) {
  return f.margen.comentar({ id: f.crear().id, anchor: ANCLA('b1', 'es difícil', 31), kind: 'pregunta' });
}

for (const primera of ['aceptar', 'descartar'] as const) {
  test(`the first decision on a fact wins: ${primera}`, async t => {
    const f = await fixture(t);
    const nb = await conPropuestas(f);
    let start!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const resumed = new Promise<void>(resolve => { resume = resolve; });
    const capture = f.kb.captureFact;
    t.mock.method(f.kb, 'captureFact', async (...args: Parameters<typeof capture>) => {
      start();
      await resumed;
      return capture(...args);
    });
    const first = primera === 'aceptar' ? aceptar(f, nb, 'hecho') : descartar(f, nb, 'hecho');
    if (primera === 'aceptar') await started;
    const second = primera === 'aceptar' ? descartar(f, nb, 'hecho') : aceptar(f, nb, 'hecho');
    const results = Promise.allSettled([first, second]);
    resume();
    const [winner, loser] = await results;
    assert.equal(winner.status, 'fulfilled');
    assert.equal(loser.status, 'rejected');
    const accepted = primera === 'aceptar';
    assert.match(String(loser.reason), accepted ? /ya se aceptó/ : /ya se descartó/);
    const store = openStudyStore(f.store.root);
    const fact = de(store.getNotebook(nb.id)!, 'hecho') as Extract<Propuesta, { tipo: 'hecho' }>;
    assert.equal(fact.estado, accepted ? 'aceptada' : 'descartada');
    const inbox = leerPorDecidir({
      estado: () => ({ units: store.listUnits(), proposals: [], plans: [] }),
      caducidad: () => null, borradores: () => store.listDrafts(),
    }, null);
    assert.deepEqual(inbox.borradores.map(draft => draft.id), accepted ? [fact.borradorId] : []);
    assert.equal(inbox.planes.length + inbox.cambios.length + inbox.sugerencias.length + inbox.borradores.length, accepted ? 1 : 0);
  });
}

test('accepting a question inserts David\'s own retrieval block right after the paragraph, with the proposed question and answer', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const out = await aceptar(f, nb, 'recuperacion');
  assert.deepEqual(out.blocks.map(b => b.kind), ['nota', 'recuperacion', 'nota', 'nota']);
  const bloque = out.blocks[1]!;
  assert.deepEqual(bloque, { id: (de(out, 'recuperacion') as { bloqueId: string }).bloqueId, kind: 'recuperacion', ...{ question: PREGUNTA.pregunta, answer: PREGUNTA.respuesta } });
  assert.equal(de(out, 'recuperacion').estado, 'aceptada');
  assert.deepEqual(out.blocks.filter(b => b.kind === 'nota'), nb.blocks, 'his paragraphs are untouched');
  assert.equal(out.revision, nb.revision + 1);
});

test('the accepted question is his: it can be edited and it is practised like any other', async t => {
  const f = await fixture(t);
  const out = await aceptar(f, await conPropuestas(f), 'recuperacion');
  const bloque = out.blocks[1]!;
  assert.deepEqual(f.cuadernos.question({ notebookId: out.id, blockId: bloque.id }), { unitId: 'u1', question: PREGUNTA.pregunta, answer: PREGUNTA.respuesta });
  const editado = f.cuadernos.save({ id: out.id, expectedRevision: out.revision, title: out.title, kind: 'libre', unitId: 'u1', documentId: 'd1', blocks: out.blocks.map(b => (b.kind === 'recuperacion' ? { ...b, question: 'La mía.' } : b)) });
  assert.equal((editado.blocks[1] as { question: string }).question, 'La mía.');
  assert.equal(de(editado, 'recuperacion').estado, 'aceptada', 'the proposal keeps its state when the page is saved again');
});

test('accepting a question twice does not duplicate the block', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const una = await aceptar(f, nb, 'recuperacion');
  const dos = await aceptar(f, nb, 'recuperacion');
  assert.equal(dos.blocks.filter(b => b.kind === 'recuperacion').length, 1);
  assert.equal(dos.revision, una.revision, 'the second click writes nothing');
});

test('two clicks at once on a question insert one block', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const res = await Promise.allSettled([aceptar(f, nb, 'recuperacion'), aceptar(f, nb, 'recuperacion')]);
  assert.equal(res.every(r => r.status === 'fulfilled'), true);
  assert.equal(f.store.getNotebook(nb.id)!.blocks.filter(b => b.kind === 'recuperacion').length, 1);
});

test('discarding a proposal leaves no trace in the page, and it cannot be accepted afterwards', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const out = await descartar(f, nb, 'recuperacion');
  assert.deepEqual(out.blocks, nb.blocks);
  assert.equal(de(out, 'recuperacion').estado, 'descartada');
  await assert.rejects(aceptar(f, out, 'recuperacion'), /descartó/);
  assert.equal((await descartar(f, out, 'recuperacion')).revision, out.revision, 'discarding twice writes nothing');
});

test('an accepted proposal cannot be discarded: what it made is decided where it lives', async t => {
  const f = await fixture(t);
  const out = await aceptar(f, await conPropuestas(f), 'recuperacion');
  await assert.rejects(descartar(f, out, 'recuperacion'), /aceptó/);
});

test('if his paragraph is gone there is nowhere to insert the question: it says so and writes nothing', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const sin = f.cuadernos.save({ id: nb.id, expectedRevision: nb.revision, title: nb.title, kind: 'libre', unitId: 'u1', documentId: 'd1', blocks: nb.blocks.filter(b => b.id !== 'b1') });
  await assert.rejects(aceptar(f, sin, 'recuperacion'), /párrafo/);
  assert.equal(de(f.store.getNotebook(nb.id)!, 'recuperacion').estado, 'pendiente');
});

test('a discarded comment cannot have its proposals accepted', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  f.margen.descartar({ id: nb.id, commentId: nb.comments![0]!.id });
  await assert.rejects(aceptar(f, nb, 'recuperacion'), /descartado/);
});

test('a proposal that is not there is not found', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  await assert.rejects(f.aceptacion.aceptar({ id: nb.id, commentId: nb.comments![0]!.id, propuestaId: 'nada' }), /no existe/);
});

test('accepting a fact makes a KBOL draft with origin tutor and its quote, and nothing is confirmed', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const out = await aceptar(f, nb, 'hecho');
  const propuesta = de(out, 'hecho') as Extract<Propuesta, { tipo: 'hecho' }>;
  assert.equal(propuesta.estado, 'aceptada');
  const borradores = f.kb.drafts();
  assert.equal(borradores.length, 1);
  const [d] = borradores;
  assert.deepEqual([d!.id, d!.origin, d!.status, d!.kind], [propuesta.borradorId, 'tutor', 'pendiente', 'hecho']);
  const hecho = d!.records.find(x => x.record.type === 'hecho')!;
  assert.match(JSON.stringify(hecho.record), /water treatment plants is hard/);
  assert.deepEqual(out.blocks, nb.blocks, 'the page is untouched');
});

test('accepting a fact twice, one after the other or at once, leaves one draft', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const [a, b] = await Promise.all([aceptar(f, nb, 'hecho'), aceptar(f, nb, 'hecho')]);
  await aceptar(f, nb, 'hecho');
  assert.equal(f.kb.drafts().length, 1);
  assert.equal((de(a, 'hecho') as { borradorId: string }).borradorId, (de(b, 'hecho') as { borradorId: string }).borradorId);
});

test('a decided draft in «Por decidir» does not bring the fact back: the proposal stays accepted', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const out = await aceptar(f, nb, 'hecho');
  await f.kb.discard({ draftId: (de(out, 'hecho') as { borradorId: string }).borradorId });
  await aceptar(f, nb, 'hecho');
  assert.equal(f.kb.drafts().length, 0);
});

test('a fact whose quote no longer verifies fails with the reason and stays pending', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const c = nb.comments![0]!;
  const roto = f.store.saveNotebook({ ...nb, revision: nb.revision + 1, comments: [{ ...c, propuestas: c.propuestas!.map(p => (p.tipo === 'hecho' ? { ...p, cita: 'texto que no está en la página' } : p)) }] }, nb.revision);
  await assert.rejects(aceptar(f, roto, 'hecho'), /no se verifica/);
  assert.equal(de(f.store.getNotebook(nb.id)!, 'hecho').estado, 'pendiente');
  assert.equal(f.kb.drafts().length, 0);
});

test('a connection is not accepted: it is opened', async t => {
  const f = await fixture(t);
  await assert.rejects(aceptar(f, await conPropuestas(f), 'conexion'), /se abre/);
});

test('discarding a connection or a fact does not touch the page or the base', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const a = await descartar(f, nb, 'conexion');
  const b = await descartar(f, a, 'hecho');
  assert.deepEqual(b.blocks, nb.blocks);
  assert.deepEqual(propuestasDe(b).map(p => p.estado), ['pendiente', 'descartada', 'descartada']);
  assert.equal(f.kb.drafts().length, 0);
});

test('the comment keeps its state and thread when a proposal is decided, and what changed while the tutor thought is not lost', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const c = nb.comments![0]!;
  const respondido = f.margen.responder({ id: nb.id, commentId: c.id, text: 'Sigo.' });
  const out = await aceptar(f, respondido, 'recuperacion');
  assert.deepEqual(out.comments![0]!.thread.map(m => m.text), ['¿Difícil respecto a qué?', 'Sigo.']);
  assert.equal(out.comments![0]!.state, 'abierto');
});

test('the page limit holds: the question is refused in Spanish when the page is full', async t => {
  const f = await fixture(t);
  const nb = await conPropuestas(f);
  const lleno = Array.from({ length: 499 }, (_, i) => ({ id: `x${i}`, kind: 'nota' as const, symbol: null, text: 't', locator: '', quote: '' }));
  const relleno = f.store.saveNotebook({ ...nb, revision: nb.revision + 1, blocks: [...nb.blocks, ...lleno.slice(0, 497)] }, nb.revision);
  await assert.rejects(aceptar(f, relleno, 'recuperacion'), /admite hasta 500 bloques/);
});

test('accepting and discarding a fact at once: the first decision wins, in either order, and the draft follows it', async t => {
  const a = await fixture(t);
  const nbA = await conPropuestas(a);
  const [r1, r2] = await Promise.allSettled([aceptar(a, nbA, 'hecho'), descartar(a, nbA, 'hecho')]);
  assert.equal(r1.status, 'fulfilled');
  assert.equal(r2.status, 'rejected');
  assert.equal(de(a.store.getNotebook(nbA.id)!, 'hecho').estado, 'aceptada');
  assert.equal(a.kb.drafts().length, 1);

  const b = await fixture(t);
  const nbB = await conPropuestas(b);
  const [s1, s2] = await Promise.allSettled([descartar(b, nbB, 'hecho'), aceptar(b, nbB, 'hecho')]);
  assert.equal(s1.status, 'fulfilled');
  assert.equal(s2.status, 'rejected');
  assert.equal(de(b.store.getNotebook(nbB.id)!, 'hecho').estado, 'descartada');
  assert.equal(b.kb.drafts().length, 0, 'a discarded fact never reaches the base');
});
