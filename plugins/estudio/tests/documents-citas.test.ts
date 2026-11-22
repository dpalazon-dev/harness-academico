import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contains, normalizeQuote, parsePdfAnchor, verifyQuote } from '../src/documents/citas.ts';
import { estructura } from './documents-fixtures.ts';

test('normalization matches KBOL\'s own vector', () => {
  // kbol/tests/test_citas.py::test_normalizar
  assert.equal(normalizeQuote('La obli-\ngación  “no” cesa­'), normalizeQuote('la obligación "no" cesa'));
});

test('words split in the representation match without spaces, as in KBOL', () => {
  // kbol/tests/test_citas.py::test_palabras_partidas_en_la_representacion
  assert.equal(contains('El fabri cante notifi cará simultá neamente', 'El fabricante notificará simultáneamente'), 'sin espacios');
});

test('a quote on its page resolves; across a hyphenated line break and typographic quotes too', () => {
  assert.deepEqual(verifyQuote(estructura(), 1, 'anomaly  detection in WATER treatment'), { estado: 'resuelta', coincidencia: 'exacta', motivo: 'resuelta' });
  assert.equal(verifyQuote(estructura(), 2, 'a graph neural network with "attention"').estado, 'resuelta');
  assert.equal(verifyQuote(estructura(), 1, 'SWaT F1 0.89').estado, 'resuelta');
});

test('a quote on the neighbouring page, a missing page or an absent quote is broken; an empty quote is not checkable', () => {
  assert.equal(verifyQuote(estructura(), 2, 'Anomaly detection in water').estado, 'rota');
  assert.match(verifyQuote(estructura(), 9, 'x').motivo, /página 9 no existe/);
  assert.equal(verifyQuote(estructura(), 1, 'transformers outperform').estado, 'rota');
  assert.equal(verifyQuote(estructura(), 1, '  ').estado, 'no_comprobable');
});

test('pdf-v1 anchors follow KBOL\'s grammar', () => {
  assert.deepEqual(parsePdfAnchor('pdf-v1:p=8'), { p: 8 });
  assert.deepEqual(parsePdfAnchor('pdf-v1:p=8;r=0.1,0.2,0.5,0.9'), { p: 8, r: [0.1, 0.2, 0.5, 0.9] });
  for (const bad of ['pdf-v1:p=0', 'pdf-v1:p=x', 'pdf-v1:p=8;r=0.5,0.2,0.1,0.9', 'pdf-v1:p=8;r=0.1,0.2,0.5', 'pdf-v1:p=8;r=0.12345,0,1,1', 'lines-v1:1-2']) {
    assert.equal(parsePdfAnchor(bad), null, bad);
  }
});

test('character classes follow Python: no combining marks in words, Python whitespace only', () => {
  // Expected values computed with KBOL's normalizar() under Python 3.
  assert.equal(normalizeQuote('x\u0302-\nb'), 'x\u0302-\nb'.normalize('NFKC').replace(/\n/, ' ').toLowerCase());
  assert.equal(normalizeQuote('foo\uFEFFbar'), 'foo\uFEFFbar');
  assert.equal(normalizeQuote('a\x1Cb'), 'a b');
  assert.equal(normalizeQuote('obli-\ngación'), 'obligación');
});

test('a quote that normalizes to nothing is not checkable', () => {
  assert.equal(verifyQuote(estructura(), 1, '\u00AD').estado, 'no_comprobable');
});
