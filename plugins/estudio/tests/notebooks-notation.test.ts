import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYMBOLS, composeNote, deduceNote } from '../src/notebooks/types.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import { tempStore, NOW } from './study-fixtures.ts';

test('un símbolo de la notación al inicio del párrafo, seguido de un espacio, se separa del texto', () => {
  assert.deepEqual(deduceNote('? ¿Por qué converge?'), { symbol: '?', text: '¿Por qué converge?' });
  assert.deepEqual(deduceNote('→ Relaja aristas'), { symbol: '→', text: 'Relaja aristas' });
  assert.deepEqual(deduceNote('Ex: el grafo de la red de agua'), { symbol: 'Ex:', text: 'el grafo de la red de agua' });
  assert.deepEqual(deduceNote('CE: pesos negativos'), { symbol: 'CE:', text: 'pesos negativos' });
  assert.deepEqual(deduceNote('Δ Antes creía otra cosa'), { symbol: 'Δ', text: 'Antes creía otra cosa' });
  assert.deepEqual(deduceNote('− Cuesta memoria'), { symbol: '−', text: 'Cuesta memoria' });
});

test('los 18 símbolos se reconocen y ninguno falla por ser prefijo de otro', () => {
  for (const s of SYMBOLS) assert.deepEqual(deduceNote(`${s} algo`), { symbol: s, text: 'algo' }, s);
});

test('sin símbolo, o con el símbolo pegado a otra cosa, el párrafo queda como se escribió', () => {
  assert.deepEqual(deduceNote('Una idea cualquiera'), { symbol: null, text: 'Una idea cualquiera' });
  assert.deepEqual(deduceNote('?pregunta sin espacio'), { symbol: null, text: '?pregunta sin espacio' });
  assert.deepEqual(deduceNote('Ideal es otra palabra'), { symbol: null, text: 'Ideal es otra palabra' });
  assert.deepEqual(deduceNote('  → con sangría'), { symbol: null, text: '  → con sangría' });
  assert.deepEqual(deduceNote('Dijo que → era claro'), { symbol: null, text: 'Dijo que → era claro' });
  assert.deepEqual(deduceNote('→\nsalto de línea'), { symbol: null, text: '→\nsalto de línea' });
  assert.deepEqual(deduceNote(''), { symbol: null, text: '' });
});

test('el resto del texto se conserva tal cual, sin recortar, para recomponer lo escrito', () => {
  assert.deepEqual(deduceNote('?  dos espacios'), { symbol: '?', text: ' dos espacios' });
  assert.deepEqual(deduceNote('? '), { symbol: '?', text: '' });
  for (const raw of ['? ¿Por qué?', '?  doble', '? ', 'sin símbolo', '→ a\nb']) {
    const { symbol, text } = deduceNote(raw);
    assert.equal(composeNote(symbol, text), raw, raw);
  }
});

test('guardar deduce el símbolo de una nota nueva o cambiada, y no toca una nota que no cambió', t => {
  const store = tempStore(t);
  let n = 0;
  const s = createNotebookService(store, { now: () => NOW, newId: () => `id${++n}` });
  const nb = s.create({ title: 'Prueba', kind: 'libre' });
  const nota = (id: string, symbol: string | null, text: string) => ({ id, kind: 'nota', symbol, text, locator: '', quote: '' });
  const primero = s.save({
    id: nb.id, expectedRevision: 1, title: 'Prueba', kind: 'libre', unitId: null, documentId: null,
    blocks: [nota('a', null, '? ¿Seguro?'), nota('b', null, 'I think so'), nota('c', null, 'Sin símbolo')],
  });
  // `I think so` también empieza por un símbolo: es la regla, se deduce.
  assert.deepEqual(primero.blocks.map(b => b.kind === 'nota' && [b.symbol, b.text]), [['?', '¿Seguro?'], ['I', 'think so'], [null, 'Sin símbolo']]);
  // Un símbolo ya guardado no se vuelve a tocar y una nota sin símbolo que no cambió se queda sin él.
  const guardada = s.save({ id: nb.id, expectedRevision: primero.revision, title: 'Prueba', kind: 'libre', unitId: null, documentId: null, blocks: primero.blocks });
  assert.deepEqual(guardada.blocks, primero.blocks);
});

test('una nota antigua sin símbolo cuyo texto empieza como uno se conserva mientras no se edite', t => {
  const store = tempStore(t);
  const s = createNotebookService(store, { now: () => NOW, newId: () => 'id1' });
  const nb = s.create({ title: 'Antiguo', kind: 'libre' });
  // Estado guardado antes de existir la deducción: se escribe saltándose el servicio.
  const antigua = { id: 'a', kind: 'nota' as const, symbol: null, text: 'I think so', locator: '', quote: '' };
  const base = store.saveNotebook({ ...nb, revision: 2, blocks: [antigua] }, 1);
  const guardada = s.save({ id: nb.id, expectedRevision: base.revision, title: 'Antiguo', kind: 'libre', unitId: null, documentId: null, blocks: [antigua] });
  assert.deepEqual(guardada.blocks, [antigua]);
});
