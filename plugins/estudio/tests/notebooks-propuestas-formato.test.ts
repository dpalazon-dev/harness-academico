import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARGIN_SYSTEM, PROACTIVE_SYSTEM, THREAD_SYSTEM } from '../src/notebooks/margen-prompts.ts';
import { separarPropuestas, validarPropuestas, type ContextoPropuestas } from '../src/notebooks/propuestas.ts';
import type { Block, Propuesta } from '../src/notebooks/types.ts';
import { parseComment } from '../src/notebooks/types.ts';

const CITA = { documentId: 'd1', pagina: 3, cita: 'water treatment plants is hard' };
function contexto(cambios: Partial<ContextoPropuestas> = {}): ContextoPropuestas {
  let n = 0;
  return {
    newId: () => `p${++n}`, cita: CITA, existentes: [],
    destino: (tipo, id) => (id === 'u2' && tipo === 'unidad' ? { titulo: 'Gradiente' } : id === 'n2' && tipo === 'cuaderno' ? { titulo: 'Redes' } : null),
    ...cambios,
  };
}
const TODAS = {
  recuperacion: { pregunta: '¿Por qué es denso un embedding?', respuesta: 'Porque cada dimensión lleva información.' },
  hecho: { afirmacion: 'Detectar anomalías en plantas de agua es difícil.' },
  conexion: { tipo: 'unidad', id: 'u2', motivo: 'Usa el mismo gradiente.' },
};

test('a reply without the tag is only text', () => {
  assert.deepEqual(separarPropuestas('¿Denso respecto a qué?'), { texto: '¿Denso respecto a qué?', json: null });
});

test('the proposals tag is cut from the visible text and its JSON is returned', () => {
  const r = separarPropuestas(`¿Denso respecto a qué?\n\n<propuestas>${JSON.stringify(TODAS)}</propuestas>`);
  assert.equal(r.texto, '¿Denso respecto a qué?');
  assert.deepEqual(r.json, TODAS);
});

test('JSON inside code fences still counts', () => {
  const r = separarPropuestas('Texto.\n<propuestas>\n```json\n{"hecho":{"afirmacion":"x"}}\n```\n</propuestas>');
  assert.equal(r.texto, 'Texto.');
  assert.deepEqual(r.json, { hecho: { afirmacion: 'x' } });
});

test('a malformed or unclosed tag leaves the text clean and no proposals, instead of showing the markup', () => {
  assert.deepEqual(separarPropuestas('Texto.\n<propuestas>{"hecho": {"afirmacion": </propuestas>'), { texto: 'Texto.', json: null });
  assert.deepEqual(separarPropuestas('Texto.\n<propuestas>{"hecho": {"afirm'), { texto: 'Texto.', json: null });
  assert.deepEqual(separarPropuestas('Texto.\n<propuestas>no es json</propuestas>'), { texto: 'Texto.', json: null });
});

test('text after the closing tag is kept', () => {
  assert.equal(separarPropuestas('Antes.<propuestas>{}</propuestas> Después.').texto, 'Antes. Después.');
});

test('each kind becomes one pending proposal with its own id; the citation comes from the context, never from the model', () => {
  const out = validarPropuestas({ ...TODAS, hecho: { afirmacion: 'Una afirmación.', documentId: 'otro', pagina: 99, cita: 'inventada' } }, contexto());
  assert.deepEqual(out.map(p => [p.id, p.tipo, p.estado]), [['p1', 'recuperacion', 'pendiente'], ['p2', 'hecho', 'pendiente'], ['p3', 'conexion', 'pendiente']]);
  const hecho = out[1] as Extract<Propuesta, { tipo: 'hecho' }>;
  assert.deepEqual([hecho.documentId, hecho.pagina, hecho.cita, hecho.afirmacion], ['d1', 3, 'water treatment plants is hard', 'Una afirmación.']);
  const conexion = out[2] as Extract<Propuesta, { tipo: 'conexion' }>;
  assert.deepEqual([conexion.destino, conexion.titulo, conexion.motivo], [{ tipo: 'unidad', id: 'u2' }, 'Gradiente', 'Usa el mismo gradiente.']);
});

test('a retrieval proposal is a question and an answer, both required, and nothing else survives', () => {
  const out = validarPropuestas({ recuperacion: { pregunta: '¿Por qué?', respuesta: 'Porque sí.', extra: 'x', texto: 'párrafo para pegar' } }, contexto());
  assert.deepEqual(Object.keys(out[0]!).sort(), ['estado', 'id', 'pregunta', 'respuesta', 'tipo']);
  assert.deepEqual(validarPropuestas({ recuperacion: { pregunta: '¿Por qué?' } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ recuperacion: { pregunta: '  ', respuesta: 'a' } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ recuperacion: { pregunta: 3, respuesta: 'a' } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ recuperacion: 'texto' }, contexto()), []);
});

test('text over the limits is not cut: the proposal is refused', () => {
  assert.deepEqual(validarPropuestas({ recuperacion: { pregunta: 'a'.repeat(401), respuesta: 'b' } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ recuperacion: { pregunta: 'a', respuesta: 'b'.repeat(1201) } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ hecho: { afirmacion: 'a'.repeat(601) } }, contexto()), []);
});

test('the question is one line: whitespace is collapsed', () => {
  const [p] = validarPropuestas({ recuperacion: { pregunta: '¿Por\n  qué?', respuesta: 'Porque\nsí.' } }, contexto()) as Extract<Propuesta, { tipo: 'recuperacion' }>[];
  assert.equal(p!.pregunta, '¿Por qué?');
  assert.equal(p!.respuesta, 'Porque\nsí.');
});

test('a fact is only offered when the paragraph quotes a page of his source', () => {
  assert.deepEqual(validarPropuestas({ hecho: { afirmacion: 'Algo.' } }, contexto({ cita: null })), []);
});

test('a connection must point to a unit or notebook that exists; otherwise it is not offered', () => {
  assert.deepEqual(validarPropuestas({ conexion: { tipo: 'unidad', id: 'inventada', motivo: 'x' } }, contexto()), []);
  assert.deepEqual(validarPropuestas({ conexion: { tipo: 'cuaderno', id: 'u2', motivo: 'x' } }, contexto()), [], 'a unit id is not a notebook');
  assert.deepEqual(validarPropuestas({ conexion: { tipo: 'proyecto', id: 'u2', motivo: 'x' } }, contexto()), []);
  const [ok] = validarPropuestas({ conexion: { tipo: 'cuaderno', id: 'n2', motivo: 'Habla de lo mismo.' } }, contexto()) as Extract<Propuesta, { tipo: 'conexion' }>[];
  assert.deepEqual([ok!.destino, ok!.titulo], [{ tipo: 'cuaderno', id: 'n2' }, 'Redes']);
});

test('kinds that do not exist are ignored and the others still count', () => {
  const out = validarPropuestas({ dibujo: { mermaid: 'graph TD' }, hecho: { afirmacion: 'Algo.' } }, contexto());
  assert.deepEqual(out.map(p => p.tipo), ['hecho']);
});

test('what is not an object proposes nothing', () => {
  for (const v of [null, undefined, 'x', 3, [], [TODAS]]) assert.deepEqual(validarPropuestas(v, contexto()), []);
});

test('one pending proposal of each kind per comment; the same text is not offered again, even after it was discarded', () => {
  const existentes: Propuesta[] = [
    { id: 'a', tipo: 'recuperacion', estado: 'pendiente', pregunta: '¿Uno?', respuesta: 'Sí.' },
    { id: 'b', tipo: 'hecho', estado: 'descartada', afirmacion: 'Detectar anomalías en plantas de agua es difícil.', documentId: 'd1', pagina: 3, cita: 'water treatment plants is hard' },
  ];
  const out = validarPropuestas(TODAS, contexto({ existentes }));
  assert.deepEqual(out.map(p => p.tipo), ['conexion'], 'question: one is pending; fact: same text was discarded');
});

test('a distinct fact is offered again once the previous one was decided', () => {
  const existentes: Propuesta[] = [{ id: 'b', tipo: 'hecho', estado: 'aceptada', afirmacion: 'Otra cosa.', documentId: 'd1', pagina: 3, cita: 'c', borradorId: 'x' }];
  assert.deepEqual(validarPropuestas({ hecho: { afirmacion: 'Una nueva.' } }, contexto({ existentes })).map(p => p.tipo), ['hecho']);
});

test('a comment holds at most six proposals in all', () => {
  const existentes: Propuesta[] = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, tipo: 'recuperacion' as const, estado: 'descartada' as const, pregunta: `¿${i}?`, respuesta: 'r' }));
  assert.deepEqual(validarPropuestas(TODAS, contexto({ existentes })), []);
});

test('the proposals of a comment are stored and read back exactly; a comment without them reads as before', () => {
  const base = { id: 'c1', anchor: { blockId: 'b1', text: 'x', start: 0, end: 1, prefix: '', suffix: '' }, persona: 'profesor', kind: 'pregunta', state: 'abierto', createdAt: 't', thread: [] };
  assert.equal('propuestas' in parseComment(base, 'c'), false);
  const propuestas: Propuesta[] = validarPropuestas(TODAS, contexto());
  assert.deepEqual(parseComment(JSON.parse(JSON.stringify({ ...base, propuestas })), 'c').propuestas, propuestas);
  assert.throws(() => parseComment({ ...base, propuestas: [{ id: 'x', tipo: 'dibujo', estado: 'pendiente' }] }, 'c'), /tipo/);
  assert.throws(() => parseComment({ ...base, propuestas: [{ id: 'x', tipo: 'recuperacion', estado: 'raro', pregunta: 'a', respuesta: 'b' }] }, 'c'), /estado/);
  assert.throws(() => parseComment({ ...base, propuestas: [propuestas[0], propuestas[0]] }, 'c'), /repetidos|repeated/);
});

test('the instructions allow proposals but still forbid text for his page, in the three prompts', () => {
  for (const [nombre, prompt] of [['margen', MARGIN_SYSTEM], ['hilo', THREAD_SYSTEM], ['proactivo', PROACTIVE_SYSTEM]] as const) {
    assert.match(prompt, /Never rewrite, correct or complete his text/, nombre);
    assert.match(prompt, /Never return text for him to paste into the page/, nombre);
    assert.match(prompt, /retrieval question is one question and the answer you expect/, nombre);
    assert.match(prompt, /never put the question or its answer in the comment text/i, nombre);
    assert.match(prompt, /never write prose for his page/i, nombre);
    assert.match(prompt, /an id from the list/i, nombre);
    assert.match(prompt, /the quote and the page come from the context/i, nombre);
  }
  assert.match(MARGIN_SYSTEM, /<propuestas>/);
  assert.match(THREAD_SYSTEM, /<propuestas>/);
  assert.match(PROACTIVE_SYSTEM, /"propuestas"/);
});

test('a block type the model could send for his page does not exist as a proposal', () => {
  const bloque: Block = { id: 'x', kind: 'nota', symbol: null, text: 't', locator: '', quote: '' };
  assert.deepEqual(validarPropuestas({ nota: { text: bloque.kind }, parrafo: { text: 'pega esto' } }, contexto()), []);
});

test('the three prompts ask for proposals on the tutor\'s own initiative and keep their limits', () => {
  for (const [nombre, prompt] of [['margen', MARGIN_SYSTEM], ['hilo', THREAD_SYSTEM], ['proactivo', PROACTIVE_SYSTEM]] as const) {
    assert.match(prompt, /You do not wait to be asked/, `${nombre}: initiative`);
    assert.match(prompt, /mechanism or a relation that deserves to be practised/, `${nombre}: when to ask a question`);
    assert.match(prompt, /a fact only when the context says the paragraph quotes his source/, `${nombre}: fact only on a quoted passage`);
    assert.match(prompt, /a connection only when a unit or notebook of the list really relates/, `${nombre}: connection only to the list`);
    assert.match(prompt, /At most one of each kind per comment, and none when nothing is worth his click/, `${nombre}: cap and restraint`);
    assert.match(prompt, /never force a proposal into every comment/, `${nombre}: no forced proposals`);
    assert.match(prompt, /never invent a quote, a page or an id/, `${nombre}: nothing invented`);
    assert.match(prompt, /Accepting is always his click/, `${nombre}: accepting is his click`);
    // The standing rules are untouched: nothing to paste, no rewriting.
    assert.match(prompt, /Never return text for him to paste into the page/, nombre);
  }
  assert.match(PROACTIVE_SYSTEM, /you only ask and point out/, 'on its own the tutor still only asks and points out');
});
