import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { PluginInference } from 'learnharness-plugin-api';
import { createNotebookService } from '../src/notebooks/service.ts';
import { createMargen } from '../src/notebooks/margen.ts';
import { createPersonajes } from '../src/notebooks/personajes.ts';
import { createLibro, TOPE_POR_DEFECTO } from '../src/notebooks/libro-proactivo.ts';
import { PROACTIVE_SYSTEM } from '../src/notebooks/margen-prompts.ts';
import { parseNotebook, type Comment } from '../src/notebooks/types.ts';
import type { SearchResult } from '../src/kb/search.ts';
import { tempStore, NOW } from './study-fixtures.ts';

/* Ticket 12e: el tutor comenta solo. El cliente de inferencia del host está simulado; no hay temporizadores ni modelo real. */

const P1 = 'Funciona con pesos negativos siempre que no haya ciclos negativos, porque el camino mínimo sigue definido.';
const BLOCKS = [
  { id: 'b1', kind: 'nota', symbol: '→', text: 'Dijkstra mantiene un conjunto de vértices cerrados.', locator: '', quote: '' },
  { id: 'b2', kind: 'nota', symbol: null, text: P1, locator: '', quote: '' },
  { id: 'b3', kind: 'nota', symbol: '?', text: '¿Por qué una cola de prioridad baja la complejidad?', locator: '', quote: '' },
];
const SIN_HITS: SearchResult = { hits: [], relacionados: [], cobertura: { registros: 0, secciones: 0, conversaciones: 0, notas: 0, documentosNoListos: 0, coincidencias: 0, truncado: false }, vacio: 'sin_coincidencias' };
const BARATO = { provider: 'claude-code', id: 'sonnet' };
const FUERTE = { provider: 'claude-code', id: 'opus' };
const COMENTARIO = JSON.stringify({ fragment: 'siempre que no haya ciclos negativos', comment: '¿Seguro? ¿Qué pasa con una arista negativa sin ciclos en Dijkstra?' });

interface Llamada { model: unknown; purpose: string; systemPrompt: string; user: string }

function fixture(t: TestContext, { barato = true, parada = 'stop', respuesta = COMENTARIO } = {}) {
  const store = tempStore(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-libro-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const ids = () => `id${++n}`;
  let reloj = NOW;
  const llamadas: Llamada[] = [];
  let texto = respuesta;
  let estado = parada;
  let barrera: Promise<void> | null = null;
  const inference = {
    async catalog() {
      return { slots: { strong: { model: FUERTE }, ...(barato ? { cheap: { model: BARATO, thinkingLevel: 'off' } } : {}) } };
    },
    async complete(request: { model: unknown; purpose: string; context: { systemPrompt: string; messages: { content: string }[] } }) {
      llamadas.push({ model: request.model, purpose: request.purpose, systemPrompt: request.context.systemPrompt, user: request.context.messages.map(m => m.content).join('\n') });
      if (barrera) await barrera;
      const usage = { input: 1200, output: 80, cacheRead: 300, cacheWrite: 50, totalTokens: 1630, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      if (estado === 'error') return { role: 'assistant', stopReason: 'error', errorMessage: 'caído', content: [], usage };
      return { role: 'assistant', stopReason: estado, content: [{ type: 'text', text: texto }], usage };
    },
  } as unknown as PluginInference;
  const libro = createLibro(dir, { now: () => reloj, timeZone: 'Europe/Madrid' });
  const cuadernos = createNotebookService(store, { now: () => reloj, newId: ids });
  const margen = createMargen(store, { inference, signal: new AbortController().signal, now: () => reloj, newId: ids, buscar: () => SIN_HITS, libro, personajes: createPersonajes(dir) });
  const crear = (unitId: string | null = null) => {
    const nb = cuadernos.create({ title: 'Dijkstra', kind: 'libre', ...(unitId ? { unitId } : {}) });
    return cuadernos.save({ id: nb.id, expectedRevision: 1, title: 'Dijkstra', kind: 'libre', unitId, documentId: null, blocks: BLOCKS });
  };
  return {
    store, cuadernos, margen, libro, llamadas, crear, dir,
    responderCon: (t: string) => { texto = t; },
    fallar: (v = true) => { estado = v ? 'error' : 'stop'; },
    reloj: (iso: string) => { reloj = iso; },
    retener: () => { let soltar!: () => void; barrera = new Promise<void>(r => { soltar = r; }); return () => { barrera = null; soltar(); }; },
  };
}

test('un cuaderno nuevo está en «Lee y comenta solo»: sin campo guardado, y el modo se lee como proactivo', t => {
  const f = fixture(t);
  const nb = f.crear();
  assert.equal(nb.modo, undefined);
  assert.equal('aviso' in parseNotebook(JSON.parse(JSON.stringify(nb))), false);
});

test('el interruptor guarda el modo por cuaderno, sin tocar la página ni los comentarios', async t => {
  const f = fixture(t);
  const a = f.crear();
  const b = f.crear();
  const fuera = await f.margen.modo({ id: a.id, modo: 'a-peticion' });
  assert.equal(fuera.modo, 'a-peticion');
  assert.deepEqual(fuera.blocks, a.blocks);
  assert.equal(fuera.revision, a.revision + 1);
  assert.equal(f.store.getNotebook(b.id)!.modo, undefined, 'el otro cuaderno sigue como estaba');
  const dentro = await f.margen.modo({ id: a.id, modo: 'proactivo' });
  assert.equal(dentro.modo, undefined, 'el modo por defecto no se guarda');
  await assert.rejects(async () => f.margen.modo({ id: a.id, modo: 'otro' }), /modo/);
});

test('un comentario proactivo se guarda en el margen: origen, modelo barato y segundo plano, y la página queda intacta', async t => {
  const f = fixture(t);
  const antes = f.crear();
  const out = await f.margen.leer({ id: antes.id, blockId: 'b2' });
  assert.equal(out.resultado, 'comentado');
  assert.deepEqual(out.cuaderno.blocks, antes.blocks);
  assert.equal(out.cuaderno.title, antes.title);
  const [c] = out.cuaderno.comments as Comment[];
  assert.equal(out.cuaderno.comments!.length, 1);
  assert.deepEqual([c!.origen, c!.kind, c!.state, c!.persona], ['proactivo', 'pregunta', 'abierto', 'profesor']);
  assert.equal(c!.anchor.blockId, 'b2');
  assert.equal(c!.anchor.text, 'siempre que no haya ciclos negativos');
  assert.equal(c!.anchor.start, P1.indexOf('siempre que'));
  assert.deepEqual(c!.thread.map(m => [m.role, m.text]), [['tutor', '¿Seguro? ¿Qué pasa con una arista negativa sin ciclos en Dijkstra?']]);
  // El modelo es el barato (con su nivel de razonamiento) y la llamada es de segundo plano.
  assert.equal(f.llamadas.length, 1);
  assert.deepEqual(f.llamadas[0]!.model, { ...BARATO, thinkingLevel: 'off' });
  assert.equal(f.llamadas[0]!.purpose, 'background');
  assert.equal(out.cuaderno.revision, antes.revision + 1);
});

test('el contexto lleva el cuaderno entero y señala el párrafo que toca', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  const u = f.llamadas[0]!.user;
  assert.match(u, /\[Notebook\] Dijkstra/);
  assert.match(u, /1\. → Dijkstra mantiene/);
  assert.match(u, /3\. \? ¿Por qué una cola/);
  assert.match(u, /paragraph 2/);
  assert.ok(u.includes(P1));
});

test('el prompt del modo proactivo solo pregunta y señala, calla ante lo trivial y nunca devuelve texto para pegar', () => {
  assert.match(PROACTIVE_SYSTEM, /Never return text for him to paste into the page/);
  assert.match(PROACTIVE_SYSTEM, /Never rewrite, correct or complete his text/);
  assert.match(PROACTIVE_SYSTEM, /only ask and point out/i);
  assert.match(PROACTIVE_SYSTEM, /never explain/i);
  assert.match(PROACTIVE_SYSTEM, /never draw/i);
  assert.match(PROACTIVE_SYSTEM, /trivial/i);
  assert.match(PROACTIVE_SYSTEM, /"comment": null/);
  assert.match(PROACTIVE_SYSTEM, /Spanish \(Spain\)/);
});

test('«sin comentario»: si el modelo no ve nada valioso no se crea nada, pero la llamada se cuenta', async t => {
  const f = fixture(t, { respuesta: JSON.stringify({ fragment: null, comment: null }) });
  const nb = f.crear();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.equal(out.resultado, 'sin-comentario');
  assert.equal(out.cuaderno.comments, undefined);
  assert.equal(out.cuaderno.revision, nb.revision, 'ni la revisión sube');
  assert.equal(f.libro.usadasHoy(), 1);
  assert.equal(f.libro.lecturas()[0]!.resultado, 'sin-comentario');
});

test('«sin comentario» también cuando el modelo contesta con texto suelto o vacío', async t => {
  for (const respuesta of ['Sin comentario', '', 'sin comentario.', '{"comment": ""}']) {
    const f = fixture(t, { respuesta });
    const nb = f.crear();
    const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
    assert.equal(out.resultado, 'sin-comentario', respuesta);
    assert.equal(out.cuaderno.comments, undefined);
  }
});

test('un comentario en texto suelto (sin JSON) se aprovecha y ancla al párrafo entero', async t => {
  const f = fixture(t, { respuesta: '¿Qué ocurre si una arista negativa sale del origen?' });
  const nb = f.crear();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  const c = out.cuaderno.comments![0]!;
  assert.equal(c.anchor.text, P1);
  assert.equal(c.thread[0]!.text, '¿Qué ocurre si una arista negativa sale del origen?');
});

test('si el fragmento que cita el modelo no está en el párrafo, se ancla al párrafo entero', async t => {
  const f = fixture(t, { respuesta: JSON.stringify({ fragment: 'algo que David no escribió', comment: '¿Y los ciclos de peso cero?' }) });
  const nb = f.crear();
  const c = (await f.margen.leer({ id: nb.id, blockId: 'b2' })).cuaderno.comments![0]!;
  assert.equal(c.anchor.text, P1);
});

test('con un párrafo que lleva símbolo, el ancla se mide sobre el texto que David ve', async t => {
  const f = fixture(t, { respuesta: JSON.stringify({ fragment: 'vértices cerrados', comment: '¿Cerrados por qué criterio?' }) });
  const nb = f.crear();
  const c = (await f.margen.leer({ id: nb.id, blockId: 'b1' })).cuaderno.comments![0]!;
  assert.equal(c.anchor.start, '→ Dijkstra mantiene un conjunto de '.length);
  assert.equal(c.anchor.text, 'vértices cerrados');
});

test('en «Cuando se lo pido» no hay ninguna llamada proactiva', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await f.margen.modo({ id: nb.id, modo: 'a-peticion' });
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'modo']);
  assert.equal(f.llamadas.length, 0);
  assert.equal(f.libro.usadasHoy(), 0);
});

test('sin modelo barato no se comenta solo y no se cae al fuerte', async t => {
  const f = fixture(t, { barato: false });
  const nb = f.crear();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'sin-modelo']);
  assert.equal(f.llamadas.length, 0, 'ni siquiera con el modelo fuerte configurado');
  assert.equal(out.estado.modeloEconomico, false);
  // El cuaderno no cambia de modo por esto: en cuanto haya modelo, sigue donde estaba.
  assert.equal(out.cuaderno.modo, undefined);
  // Y activar el modo proactivo sin modelo económico dice por qué no.
  await f.margen.modo({ id: nb.id, modo: 'a-peticion' });
  await assert.rejects(f.margen.modo({ id: nb.id, modo: 'proactivo' }), /modelo económico/);
});

test('uno por párrafo: no vuelve a comentar un párrafo que ya comentó, ni aunque David descartara el comentario', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const primero = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.equal(f.llamadas.length, 1);
  const otra = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual([otra.resultado, otra.motivo], ['omitido', 'ya-comentado']);
  f.margen.descartar({ id: nb.id, commentId: primero.cuaderno.comments![0]!.id });
  const tras = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual([tras.resultado, tras.motivo], ['omitido', 'ya-comentado']);
  assert.equal(f.llamadas.length, 1);
});

test('una sola llamada en vuelo por cuaderno: la segunda lectura se omite sin llamar', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const soltar = f.retener();
  const primera = f.margen.leer({ id: nb.id, blockId: 'b2' });
  await new Promise(r => setImmediate(r));
  const segunda = await f.margen.leer({ id: nb.id, blockId: 'b3' });
  assert.deepEqual([segunda.resultado, segunda.motivo], ['omitido', 'en-vuelo']);
  soltar();
  assert.equal((await primera).resultado, 'comentado');
  assert.equal(f.llamadas.length, 1);
  // Y acabada la primera, ya cabe otra.
  assert.equal((await f.margen.leer({ id: nb.id, blockId: 'b3' })).resultado, 'comentado');
});

test('cuadernos distintos no se bloquean entre sí', async t => {
  const f = fixture(t);
  const a = f.crear();
  const b = f.crear();
  const soltar = f.retener();
  const pa = f.margen.leer({ id: a.id, blockId: 'b2' });
  const pb = f.margen.leer({ id: b.id, blockId: 'b2' });
  await new Promise(r => setImmediate(r));
  soltar();
  assert.deepEqual([(await pa).resultado, (await pb).resultado], ['comentado', 'comentado']);
});

test('el tope diario: al alcanzarlo el cuaderno pasa a «Cuando se lo pido» con el aviso, y no hay más llamadas', async t => {
  const f = fixture(t);
  f.libro.setTope(2);
  const nb = f.crear();
  const uno = await f.margen.leer({ id: nb.id, blockId: 'b1' });
  assert.equal(uno.cuaderno.modo, undefined);
  const dos = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.equal(dos.resultado, 'comentado');
  assert.equal(dos.cuaderno.modo, 'a-peticion');
  assert.equal(dos.cuaderno.aviso, 'tope');
  assert.equal(dos.estado.usadas, 2);
  assert.equal(f.llamadas.length, 2);
  // Nada más en este cuaderno, y el comentario ya hecho se conserva.
  assert.equal(dos.cuaderno.comments!.length, 2);
  const tres = await f.margen.leer({ id: nb.id, blockId: 'b3' });
  assert.deepEqual([tres.resultado, tres.motivo], ['omitido', 'modo']);
  assert.equal(f.llamadas.length, 2);
});

test('el tope es de todos los cuadernos: otro cuaderno se entera al intentarlo y pasa también', async t => {
  const f = fixture(t);
  f.libro.setTope(1);
  const a = f.crear();
  const b = f.crear();
  await f.margen.leer({ id: a.id, blockId: 'b1' });
  const out = await f.margen.leer({ id: b.id, blockId: 'b1' });
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'tope']);
  assert.equal(out.cuaderno.modo, 'a-peticion');
  assert.equal(out.cuaderno.aviso, 'tope');
  assert.equal(f.llamadas.length, 1);
});

test('con el tope en 0 el modo proactivo no llama nunca', async t => {
  const f = fixture(t);
  f.libro.setTope(0);
  const nb = f.crear();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b1' });
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'tope']);
  assert.equal(f.llamadas.length, 0);
});

test('con el tope agotado no se puede volver a activar hoy; al día siguiente sí, y quita el aviso', async t => {
  const f = fixture(t);
  f.libro.setTope(1);
  const nb = f.crear();
  await f.margen.leer({ id: nb.id, blockId: 'b1' });
  await assert.rejects(f.margen.modo({ id: nb.id, modo: 'proactivo' }), /tope/);
  // Subir el tope también deja volver.
  f.libro.setTope(5);
  const activo = await f.margen.modo({ id: nb.id, modo: 'proactivo' });
  assert.deepEqual([activo.modo, activo.aviso], [undefined, undefined]);
  // Al día siguiente (hora de Madrid) el recuento vuelve a cero.
  f.libro.setTope(1);
  await f.margen.modo({ id: nb.id, modo: 'a-peticion' });
  await assert.rejects(f.margen.modo({ id: nb.id, modo: 'proactivo' }), /tope/);
  f.reloj('2026-11-12T10:00:00.000Z');
  assert.equal(f.libro.usadasHoy(), 0);
  const manana = await f.margen.modo({ id: nb.id, modo: 'proactivo' });
  assert.equal(manana.modo, undefined);
});

test('el día se cuenta en hora de Madrid: las 23:30 UTC de noviembre ya son del día siguiente', async t => {
  const f = fixture(t);
  f.libro.setTope(1);
  const nb = f.crear();
  f.reloj('2026-11-11T22:30:00.000Z');
  await f.margen.leer({ id: nb.id, blockId: 'b1' });
  assert.equal(f.libro.lecturas()[0]!.dia, '2026-11-11');
  f.reloj('2026-11-11T23:30:00.000Z');
  assert.equal(f.libro.usadasHoy(), 0);
});

test('el estado cuenta las llamadas de hoy, el tope y si hay modelo económico', async t => {
  const f = fixture(t);
  const nb = f.crear();
  assert.deepEqual(await f.margen.estado(), { tope: TOPE_POR_DEFECTO, usadas: 0, modeloEconomico: true });
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual(await f.margen.estado(), { tope: 40, usadas: 1, modeloEconomico: true });
  assert.deepEqual(await f.margen.fijarTope({ tope: 12 }), { tope: 12, usadas: 1, modeloEconomico: true });
  await assert.rejects(async () => f.margen.fijarTope({ tope: -1 }), /tope/);
  await assert.rejects(async () => f.margen.fijarTope({ tope: 1.5 }), /tope/);
  await assert.rejects(async () => f.margen.fijarTope({ tope: 100000 }), /tope/);
});

test('un fallo del modelo no reintenta, se cuenta y se devuelve como fallo con el cuaderno intacto', async t => {
  const f = fixture(t);
  const nb = f.crear();
  f.fallar();
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.equal(out.resultado, 'fallo');
  assert.match(out.motivo!, /caído/);
  assert.equal(f.llamadas.length, 1, 'una llamada y ninguna más');
  assert.equal(out.cuaderno.comments, undefined);
  assert.equal(f.libro.usadasHoy(), 1, 'un fallo también gasta del tope');
  assert.equal(f.libro.lecturas()[0]!.resultado, 'fallo');
});

test('tres fallos seguidos: el cuaderno pasa a «Cuando se lo pido» con el aviso; un acierto reinicia la cuenta', async t => {
  const f = fixture(t);
  const nb = f.crear();
  f.fallar();
  assert.equal((await f.margen.leer({ id: nb.id, blockId: 'b1' })).cuaderno.modo, undefined);
  assert.equal((await f.margen.leer({ id: nb.id, blockId: 'b2' })).cuaderno.modo, undefined);
  f.fallar(false);
  assert.equal((await f.margen.leer({ id: nb.id, blockId: 'b3' })).resultado, 'comentado');
  // La racha se rompió: otros dos fallos no bastan.
  f.fallar();
  const b = f.crear();
  assert.equal((await f.margen.leer({ id: b.id, blockId: 'b1' })).cuaderno.modo, undefined);
  assert.equal((await f.margen.leer({ id: b.id, blockId: 'b2' })).cuaderno.modo, undefined);
  const tercero = await f.margen.leer({ id: b.id, blockId: 'b3' });
  assert.equal(tercero.resultado, 'fallo');
  assert.equal(tercero.cuaderno.modo, 'a-peticion');
  assert.equal(tercero.cuaderno.aviso, 'fallos');
  // Activarlo de nuevo quita el aviso y reinicia la racha.
  const otra = await f.margen.modo({ id: b.id, modo: 'proactivo' });
  assert.equal(otra.aviso, undefined);
  assert.equal((await f.margen.leer({ id: b.id, blockId: 'b1' })).cuaderno.modo, undefined, 'tras volver, un fallo no es el tercero');
});

test('la respuesta llega a la página tal y como esté entonces: David siguió escribiendo y su texto se conserva', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const soltar = f.retener();
  const lectura = f.margen.leer({ id: nb.id, blockId: 'b2' });
  await new Promise(r => setImmediate(r));
  // Mientras el modelo piensa, David escribe otro párrafo y se guarda.
  f.cuadernos.save({ id: nb.id, expectedRevision: nb.revision, title: 'Dijkstra', kind: 'libre', unitId: null, documentId: null,
    blocks: [...BLOCKS, { id: 'b4', kind: 'nota', symbol: null, text: 'Un párrafo escrito mientras el tutor leía.', locator: '', quote: '' }] });
  soltar();
  const out = await lectura;
  assert.equal(out.resultado, 'comentado');
  assert.equal(out.cuaderno.blocks.length, 4);
  assert.equal(out.cuaderno.blocks[3]!.kind === 'nota' && out.cuaderno.blocks[3]!.text, 'Un párrafo escrito mientras el tutor leía.');
});

test('si el párrafo desapareció mientras el tutor leía, el comentario no se guarda', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const soltar = f.retener();
  const lectura = f.margen.leer({ id: nb.id, blockId: 'b2' });
  await new Promise(r => setImmediate(r));
  f.cuadernos.save({ id: nb.id, expectedRevision: nb.revision, title: 'Dijkstra', kind: 'libre', unitId: null, documentId: null, blocks: [BLOCKS[0], BLOCKS[2]] });
  soltar();
  const out = await lectura;
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'parrafo']);
  assert.equal(out.cuaderno.comments, undefined);
});

test('un párrafo que no existe o un bloque que no es una nota no se lee', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await assert.rejects(f.margen.leer({ id: nb.id, blockId: 'nope' }), /párrafo/);
  assert.equal(f.llamadas.length, 0);
});

test('con 200 comentarios sin descartados no se llama al modelo', async t => {
  const f = fixture(t);
  const nb = f.crear();
  const lleno = Array.from({ length: 200 }, (_, i): Comment => ({
    id: `c${i}`, anchor: { blockId: 'b1', text: 'x', start: 0, end: 1, prefix: '', suffix: '' }, persona: 'tutor', kind: 'pregunta', state: 'abierto', createdAt: NOW, thread: [{ id: `m${i}`, role: 'tutor', text: 'a', at: NOW }],
  }));
  f.store.saveNotebook({ ...nb, revision: nb.revision + 1, comments: lleno }, nb.revision);
  const out = await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.deepEqual([out.resultado, out.motivo], ['omitido', 'lleno']);
  assert.equal(f.llamadas.length, 0);
});

test('el libro apunta cada llamada con su propósito, tokens y duración, y sobrevive a reabrirlo', async t => {
  const f = fixture(t);
  const nb = f.crear();
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  const [l] = f.libro.lecturas();
  assert.equal(l!.notebook, nb.id);
  assert.equal(l!.block, 'b2');
  assert.equal(l!.resultado, 'comentado');
  assert.equal(l!.model, 'claude-code/sonnet');
  assert.deepEqual([l!.input, l!.output, l!.cacheRead, l!.cacheWrite], [1200, 80, 300, 50]);
  assert.equal(typeof l!.ms, 'number');
  // Otra instancia sobre la misma carpeta ve lo mismo: el tope no se reinicia al reiniciar la aplicación.
  const otra = createLibro(f.dir, { now: () => NOW, timeZone: 'Europe/Madrid' });
  assert.equal(otra.usadasHoy(), 1);
  f.libro.setTope(7);
  assert.equal(createLibro(f.dir, { now: () => NOW, timeZone: 'Europe/Madrid' }).tope(), 7);
});

test('el tope por defecto es 40 y un archivo ilegible vuelve al de por defecto', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-libro-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const libro = createLibro(dir, { now: () => NOW, timeZone: 'Europe/Madrid' });
  assert.equal(libro.tope(), 40);
  fs.writeFileSync(path.join(dir, 'proactivo.json'), '{ roto');
  assert.equal(libro.tope(), 40);
});

test('un cuaderno con modo y aviso se lee y se guarda igual; valores raros se rechazan', t => {
  const f = fixture(t);
  const nb = f.crear();
  const ida = parseNotebook(JSON.parse(JSON.stringify({ ...nb, modo: 'a-peticion', aviso: 'tope' })));
  assert.deepEqual([ida.modo, ida.aviso], ['a-peticion', 'tope']);
  assert.throws(() => parseNotebook({ ...nb, modo: 'raro' }), /modo/);
  assert.throws(() => parseNotebook({ ...nb, aviso: 'raro' }), /aviso/);
  // Guardar la página de nuevo conserva el modo.
  f.store.saveNotebook({ ...nb, revision: nb.revision + 1, modo: 'a-peticion' }, nb.revision);
  const guardado = f.cuadernos.save({ id: nb.id, expectedRevision: nb.revision + 1, title: 'Dijkstra', kind: 'libre', unitId: null, documentId: null, blocks: BLOCKS });
  assert.equal(guardado.modo, 'a-peticion');
});

test('si David editó el párrafo mientras el tutor leía, el ancla se mide sobre el texto de ahora', async t => {
  const f = fixture(t, { respuesta: JSON.stringify({ fragment: 'ciclos negativos', comment: '¿Y si el ciclo es de peso cero?' }) });
  const nb = f.crear();
  const soltar = f.retener();
  const lectura = f.margen.leer({ id: nb.id, blockId: 'b2' });
  await new Promise(r => setImmediate(r));
  const nuevo = `Antes de nada, una precisión. ${P1}`;
  f.cuadernos.save({ id: nb.id, expectedRevision: nb.revision, title: 'Dijkstra', kind: 'libre', unitId: null, documentId: null,
    blocks: [BLOCKS[0], { ...BLOCKS[1], text: nuevo }, BLOCKS[2]] });
  soltar();
  const c = (await lectura).cuaderno.comments![0]!;
  assert.equal(c.anchor.text, 'ciclos negativos');
  assert.equal(c.anchor.start, nuevo.indexOf('ciclos negativos'), 'el desplazamiento es el del texto nuevo, no el que leyó el modelo');
});

/** Un margen nuevo sobre los mismos datos, como tras reiniciar la aplicación: lo que vive en memoria se pierde. */
function reiniciar(f: ReturnType<typeof fixture>, reloj: () => string = () => NOW) {
  const libro = createLibro(f.dir, { now: reloj, timeZone: 'Europe/Madrid' });
  const inference = {
    async catalog() { return { slots: { strong: { model: FUERTE }, cheap: { model: BARATO, thinkingLevel: 'off' } } }; },
    async complete() { return { role: 'assistant', stopReason: 'error', errorMessage: 'caído', content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; },
  } as unknown as PluginInference;
  let n = 1000;
  return createMargen(f.store, { inference, signal: new AbortController().signal, now: reloj, newId: () => `r${++n}`, buscar: () => SIN_HITS, libro, personajes: createPersonajes(f.dir) });
}

test('los fallos seguidos sobreviven a reiniciar la aplicación', async t => {
  const f = fixture(t);
  const nb = f.crear();
  f.fallar();
  await f.margen.leer({ id: nb.id, blockId: 'b1' });
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  assert.equal(f.store.getNotebook(nb.id)!.modo, undefined, 'dos fallos no bastan');
  const tras = reiniciar(f);
  const tercero = await tras.leer({ id: nb.id, blockId: 'b3' });
  assert.equal(tercero.resultado, 'fallo');
  assert.equal(tercero.cuaderno.modo, 'a-peticion', 'el tercero, ya en el proceso nuevo, apaga el cuaderno');
  assert.equal(tercero.cuaderno.aviso, 'fallos');
});

test('un acierto reinicia los fallos seguidos también entre procesos', async t => {
  const f = fixture(t);
  const nb = f.crear();
  f.fallar();
  await f.margen.leer({ id: nb.id, blockId: 'b1' });
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  f.fallar(false);
  assert.equal((await f.margen.leer({ id: nb.id, blockId: 'b3' })).resultado, 'comentado');
  const tras = reiniciar(f);
  assert.equal((await tras.leer({ id: nb.id, blockId: 'b1' })).cuaderno.modo, undefined, 'tras el acierto, un fallo es el primero');
});

test('los fallos seguidos se reinician al cambiar de día', async t => {
  const f = fixture(t);
  const nb = f.crear();
  f.fallar();
  await f.margen.leer({ id: nb.id, blockId: 'b1' });
  await f.margen.leer({ id: nb.id, blockId: 'b2' });
  const manana = '2026-11-18T10:00:00.000Z';
  assert.equal(f.libro.fallosSeguidos(nb.id), 2);
  const tras = reiniciar(f, () => manana);
  const out = await tras.leer({ id: nb.id, blockId: 'b3' });
  assert.equal(out.cuaderno.modo, undefined, 'otro día, el cuaderno empieza de cero');
});
