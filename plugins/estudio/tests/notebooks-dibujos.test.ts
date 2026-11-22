import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import type { SearchResult } from '../src/kb/search.ts';
import { createLibro } from '../src/notebooks/libro-proactivo.ts';
import { createMargen } from '../src/notebooks/margen.ts';
import { DRAW_SYSTEM, MARGIN_SYSTEM, PROACTIVE_SYSTEM, THREAD_SYSTEM } from '../src/notebooks/margen-prompts.ts';
import { createPersonajes } from '../src/notebooks/personajes.ts';
import { limpiarMermaid, separarDibujo } from '../src/notebooks/dibujos.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import { MAX_DIBUJO, MAX_DIBUJOS_COMENTARIO, MAX_DIBUJOS_CUADERNO, parseNotebook, type Comment } from '../src/notebooks/types.ts';
import { NOW, tempStore } from './study-fixtures.ts';

const TEXTO = 'Dijkstra fija el nodo de menor distancia y relaja sus vecinos.';
const BLOCKS = [
  { id: 'b1', kind: 'nota', symbol: null, text: TEXTO, locator: '', quote: '' },
  { id: 'b2', kind: 'nota', symbol: null, text: 'Segundo párrafo.', locator: '', quote: '' },
];
const ANCLA = { blockId: 'b1', text: 'relaja sus vecinos', start: 44, end: 62, prefix: 'menor distancia y ', suffix: '.' };
const SIN_HITS: SearchResult = { hits: [], relacionados: [], cobertura: { registros: 0, secciones: 0, conversaciones: 0, notas: 0, documentosNoListos: 0, coincidencias: 0, truncado: false }, vacio: 'sin_coincidencias' };
const GRAFO = 'flowchart TD\n  A["Elegir el nodo de menor distancia"] --> B["Relajar a sus vecinos"]\n  B --> C{"¿Quedan nodos?"}\n  C -->|"Sí"| A\n  C -->|"No"| D["Fin"]';
const dibujo = (cuerpo = GRAFO) => `<dibujo>\n${cuerpo}\n</dibujo>`;

interface Llamada { model: { id: string }; purpose: string; system: string; user: string }

function fixture(t: TestContext, respuesta = `Los pasos, de forma esquemática.\n${dibujo()}`) {
  const store = tempStore(t);
  let n = 0;
  const ids = () => `id${++n}`;
  const llamadas: Llamada[] = [];
  let texto = respuesta;
  const inference = {
    async catalog() { return { slots: { strong: { model: { provider: 'claude-code', id: 'opus' } }, cheap: { model: { provider: 'claude-code', id: 'sonnet' } } } }; },
    async complete(r: { model: { id: string }; purpose: string; context: { systemPrompt: string; messages: { content: string }[] } }) {
      llamadas.push({ model: r.model, purpose: r.purpose, system: r.context.systemPrompt, user: r.context.messages.map(m => m.content).join('\n') });
      return { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: texto }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
    },
  } as unknown as PluginInference;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-dib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const libro = createLibro(dir, { now: () => NOW, timeZone: 'Europe/Madrid' });
  const cuadernos = createNotebookService(store, { now: () => NOW, newId: ids });
  const margen = createMargen(store, { inference, signal: new AbortController().signal, now: () => NOW, newId: ids, buscar: () => SIN_HITS, libro, personajes: createPersonajes(dir) });
  const crear = () => {
    const nb = cuadernos.create({ title: 'Grafos', kind: 'libre' });
    return cuadernos.save({ id: nb.id, expectedRevision: 1, title: 'Grafos', kind: 'libre', unitId: null, documentId: null, blocks: BLOCKS });
  };
  return { store, margen, libro, llamadas, crear, responderCon: (x: string) => { texto = x; } };
}

const comentarioDe = (nb: { comments?: Comment[] }) => nb.comments![0]!;

test('separarDibujo reads the tag, the fence inside it and a bare mermaid fence, and never leaves markup in the text', () => {
  assert.deepEqual(separarDibujo(`Así.\n${dibujo()}`), { texto: 'Así.', mermaid: GRAFO });
  assert.equal(separarDibujo(`Así.\n<dibujo>\n\`\`\`mermaid\n${GRAFO}\n\`\`\`\n</dibujo>`).mermaid, GRAFO);
  assert.deepEqual(separarDibujo(`Así.\n\`\`\`mermaid\n${GRAFO}\n\`\`\``), { texto: 'Así.', mermaid: GRAFO });
  assert.deepEqual(separarDibujo('Sin dibujo.'), { texto: 'Sin dibujo.', mermaid: null });
  // Cut short: no diagram and no tag in the text.
  assert.deepEqual(separarDibujo('Así.\n<dibujo>\nflowchart TD\n  A --> B'), { texto: 'Así.', mermaid: null, motivo: 'incompleto' });
  // Too big is refused, not cut: a truncated diagram would not compile.
  const enorme = separarDibujo(`Así.\n${dibujo(`flowchart TD\n${'  A --> B\n'.repeat(400)}`)}`);
  assert.equal(enorme.mermaid, null);
  assert.equal(enorme.motivo, 'grande');
  assert.equal(enorme.texto, 'Así.');
});

test('limpiarMermaid drops init directives and fences, and refuses what is empty or over the limit', () => {
  assert.equal(limpiarMermaid(`%%{init: {"securityLevel": "loose"}}%%\n${GRAFO}`), GRAFO);
  assert.equal(limpiarMermaid(`\`\`\`mermaid\n${GRAFO}\n\`\`\``), GRAFO);
  const anidada = limpiarMermaid(`%%%%{a}%%{init: {"theme":"base"}}%%\n${GRAFO}`);
  assert.ok(anidada === null || !anidada.includes('%%{'), 'a nested directive does not rebuild itself');
  assert.equal(limpiarMermaid(`---\nconfig:\n  theme: forest\n---\n${GRAFO}`), GRAFO);
  const codigo = separarDibujo('Código:\n```graphql\n{ a }\n```');
  assert.equal(codigo.mermaid, null);
  assert.match(codigo.texto, /graphql/);
  assert.equal(limpiarMermaid('   \n  '), null);
  assert.equal(limpiarMermaid('x'.repeat(MAX_DIBUJO + 1)), null);
  assert.equal(limpiarMermaid('x'.repeat(MAX_DIBUJO))?.length, MAX_DIBUJO);
});

test('«Dibújalo»: the strong model draws on request, the diagram is stored with the comment and the page is untouched', async t => {
  const f = fixture(t);
  const antes = f.crear();
  const out = await f.margen.comentar({ id: antes.id, anchor: ANCLA, kind: 'dibujo' });
  assert.deepEqual(out.blocks, antes.blocks);
  const c = comentarioDe(out);
  assert.equal(c.kind, 'dibujo');
  assert.deepEqual(c.thread.map(m => m.text), ['Los pasos, de forma esquemática.']);
  assert.equal(c.dibujos?.length, 1);
  assert.equal(c.dibujos![0]!.mermaid, GRAFO);
  assert.equal(c.dibujos![0]!.mensajeId, c.thread[0]!.id);
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0]!.model.id, 'opus');
  assert.equal(f.llamadas[0]!.purpose, 'user');
  assert.equal(f.llamadas[0]!.system, DRAW_SYSTEM);
  assert.match(f.llamadas[0]!.user, /relaja sus vecinos/);
  // It survives a reload and is a request, not proactive spending.
  assert.deepEqual(comentarioDe(f.store.getNotebook(antes.id)!).dibujos, c.dibujos);
  assert.equal(f.libro.usadasHoy(), 0);
});

test('«Dibújalo» without a usable diagram stores nothing and says why', async t => {
  const f = fixture(t, 'Esto no tiene nada que dibujar.');
  const nb = f.crear();
  await assert.rejects(f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' }), /Esto no tiene nada que dibujar/);
  assert.equal(f.store.getNotebook(nb.id)!.comments, undefined);
  f.responderCon(`Va.\n${dibujo(`flowchart TD\n${'  A --> B\n'.repeat(400)}`)}`);
  await assert.rejects(f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' }), /demasiado grande/);
  assert.equal(f.store.getNotebook(nb.id)!.comments, undefined);
});

test('a diagram only, with no sentence, is still a drawing with a neutral caption', async t => {
  const f = fixture(t, dibujo());
  const nb = f.crear();
  const c = comentarioDe(await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' }));
  assert.equal(c.dibujos?.length, 1);
  assert.ok(c.thread[0]!.text.length > 0);
});

test('a notebook full of drawings refuses a new one before spending a call; discarded comments make room', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const lleno = f.store.saveNotebook({
    ...nb, revision: nb.revision + 1,
    comments: Array.from({ length: MAX_DIBUJOS_CUADERNO / MAX_DIBUJOS_COMENTARIO }, (_, i) => ({
      id: `c${i}`, anchor: { ...ANCLA, blockId: 'b1' }, persona: 'tutor', kind: 'dibujo' as const, state: 'abierto' as const, createdAt: NOW,
      thread: [{ id: `m${i}`, role: 'tutor' as const, text: 'Va.', at: NOW }],
      dibujos: Array.from({ length: MAX_DIBUJOS_COMENTARIO }, (_, j) => ({ id: `d${i}-${j}`, mermaid: GRAFO, mensajeId: `m${i}` })),
    })),
  }, nb.revision);
  await assert.rejects(f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' }), /dibujos/);
  assert.equal(f.llamadas.length, 0);
  f.margen.descartar({ id: nb.id, commentId: lleno.comments![0]!.id });
  const out = await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' });
  assert.equal(out.comments!.at(-1)!.dibujos?.length, 1);
});

test('a drawing can be asked for inside a thread: it hangs from the tutor message that carries it', async t => {
  const f = fixture(t, 'Pregunta tutor: ¿qué pasa con los vecinos?');
  const nb = f.crear();
  const abierto = await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' });
  const c0 = comentarioDe(abierto);
  assert.equal(c0.dibujos, undefined);
  f.margen.responder({ id: nb.id, commentId: c0.id, text: 'Dibújame los pasos.' });
  f.responderCon(`Aquí van.\n${dibujo()}`);
  const out = await f.margen.contestar({ id: nb.id, commentId: c0.id });
  const c = comentarioDe(out);
  const ultimo = c.thread.at(-1)!;
  assert.equal(ultimo.role, 'tutor');
  assert.equal(ultimo.text, 'Aquí van.');
  assert.deepEqual(c.dibujos?.map(d => [d.mensajeId, d.mermaid]), [[ultimo.id, GRAFO]]);
  assert.equal(f.llamadas.at(-1)!.system, THREAD_SYSTEM);
  assert.equal(f.llamadas.at(-1)!.model.id, 'opus');
  // The next turn sees the diagram it drew.
  f.margen.responder({ id: nb.id, commentId: c.id, text: 'Añade el caso de pesos negativos.' });
  f.responderCon('Eso rompe Dijkstra.');
  await f.margen.contestar({ id: nb.id, commentId: c.id });
  assert.match(f.llamadas.at(-1)!.user, /Elegir el nodo de menor distancia/);
});

test('in a thread, a diagram that is too big or has no room is dropped and the message says so', async t => {
  const f = fixture(t, 'Pregunta tutor: ¿y los vecinos?');
  const nb = f.crear();
  const c0 = comentarioDe(await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' }));
  f.margen.responder({ id: nb.id, commentId: c0.id, text: 'Dibújalo.' });
  f.responderCon(`Va.\n${dibujo(`flowchart TD\n${'  A --> B\n'.repeat(400)}`)}`);
  const c = comentarioDe(await f.margen.contestar({ id: nb.id, commentId: c0.id }));
  assert.equal(c.dibujos, undefined);
  assert.match(c.thread.at(-1)!.text, /^Va\./);
  assert.match(c.thread.at(-1)!.text, /demasiado grande/);
  assert.doesNotMatch(c.thread.at(-1)!.text, /<dibujo>/);
});

test('a comment holds at most MAX_DIBUJOS_COMENTARIO drawings', async t => {
  const f = fixture(t, 'Pregunta tutor: ¿y los vecinos?');
  const nb = f.crear();
  let c = comentarioDe(await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'pregunta' }));
  for (let i = 0; i < MAX_DIBUJOS_COMENTARIO + 1; i++) {
    f.margen.responder({ id: nb.id, commentId: c.id, text: `Dibújalo otra vez ${i}.` });
    f.responderCon(`Va ${i}.\n${dibujo(`flowchart TD\n  A${i} --> B`)}`);
    c = comentarioDe(await f.margen.contestar({ id: nb.id, commentId: c.id }));
  }
  assert.equal(c.dibujos?.length, MAX_DIBUJOS_COMENTARIO);
  assert.match(c.thread.at(-1)!.text, /dibujos/);
});

test('quitarDibujo removes the diagram and nothing else: the thread and the page stay', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const c0 = comentarioDe(await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'dibujo' }));
  const out = f.margen.quitarDibujo({ id: nb.id, commentId: c0.id, dibujoId: c0.dibujos![0]!.id });
  const c = comentarioDe(out);
  assert.equal(c.dibujos, undefined);
  assert.deepEqual(c.thread, c0.thread);
  assert.deepEqual(out.blocks, nb.blocks);
  assert.equal(comentarioDe(f.store.getNotebook(nb.id)!).dibujos, undefined);
  assert.throws(() => f.margen.quitarDibujo({ id: nb.id, commentId: c0.id, dibujoId: 'no-existe' }), /no existe/);
});

test('the proactive mode never draws: its prompt forbids it, offers no diagram format, and a diagram it returns is dropped', async t => {
  assert.match(PROACTIVE_SYSTEM, /never draw/i);
  assert.doesNotMatch(PROACTIVE_SYSTEM, /<dibujo>|mermaid/i);
  assert.doesNotMatch(MARGIN_SYSTEM, /<dibujo>|mermaid/i);
  const f = fixture(t, JSON.stringify({ fragment: 'relaja sus vecinos', comment: `¿Seguro que relaja a todos?\n${dibujo()}` }));
  const nb = f.crear();
  const { cuaderno, resultado } = await f.margen.leer({ id: nb.id, blockId: 'b1' });
  assert.equal(resultado, 'comentado');
  const c = comentarioDe(cuaderno);
  assert.equal(c.dibujos, undefined);
  assert.equal(c.thread[0]!.text, '¿Seguro que relaja a todos?');
  assert.equal(f.llamadas[0]!.system, PROACTIVE_SYSTEM);
});

test('an explanation or question comment ignores a diagram nobody asked for', async t => {
  const f = fixture(t, `Relajar es actualizar la distancia.\n${dibujo()}`);
  const nb = f.crear();
  const c = comentarioDe(await f.margen.comentar({ id: nb.id, anchor: ANCLA, kind: 'explicacion' }));
  assert.equal(c.dibujos, undefined);
  assert.equal(c.thread[0]!.text, 'Relajar es actualizar la distancia.');
});

test('the drawing prompt is English, asks for one short valid Mermaid block in the language of his text, and keeps the page his', () => {
  assert.match(DRAW_SYSTEM, /single/i);
  assert.match(DRAW_SYSTEM, /<dibujo>/);
  assert.match(DRAW_SYSTEM, /Spanish/);
  assert.match(DRAW_SYSTEM, /Never rewrite, correct or complete his text/);
  assert.match(DRAW_SYSTEM, /Never return text for him to paste/);
  assert.match(THREAD_SYSTEM, /<dibujo>/);
  assert.match(THREAD_SYSTEM, /only when his last message asks/i);
});

test('comments and notebooks without drawings read as before; a drawing round-trips and a malformed one is refused', t => {
  const f = fixture(t);
  const nb = f.crear();
  assert.equal(JSON.stringify(parseNotebook(JSON.parse(JSON.stringify(nb)))).includes('dibujos'), false);
  const base = { ...nb, comments: [{ id: 'c1', anchor: ANCLA, persona: 'tutor', kind: 'dibujo', state: 'abierto', createdAt: NOW, thread: [{ id: 'm1', role: 'tutor', text: 'Va.', at: NOW }], dibujos: [{ id: 'd1', mermaid: GRAFO, mensajeId: 'm1' }] }] };
  assert.deepEqual(parseNotebook(JSON.parse(JSON.stringify(base))).comments![0]!.dibujos, [{ id: 'd1', mermaid: GRAFO, mensajeId: 'm1' }]);
  const roto = (d: unknown) => ({ ...base, comments: [{ ...base.comments[0], dibujos: [d] }] });
  assert.throws(() => parseNotebook(roto({ id: 'd1', mermaid: 'x'.repeat(MAX_DIBUJO + 1), mensajeId: 'm1' })));
  assert.throws(() => parseNotebook(roto({ id: 'd1', mermaid: '', mensajeId: 'm1' })));
  assert.throws(() => parseNotebook(roto({ id: 'd1', mermaid: GRAFO, mensajeId: 'm1', extra: 1 })));
});
