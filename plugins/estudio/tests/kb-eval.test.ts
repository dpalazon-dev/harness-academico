import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, parseBench } from '../src/kb/eval.ts';
import { buildIndex, search } from '../src/kb/search.ts';

const index = buildIndex([
  { id: 'HE-1', kind: 'hecho', title: 'GDN en SWaT', text: 'GDN obtiene F1 0,81 en SWaT', links: [] },
  { id: 'HE-2', kind: 'hecho', title: 'USAD en WADI', text: 'USAD obtiene F1 0,52 en WADI', links: [] },
  { id: 'ENT-1', kind: 'entidad', title: 'SWaT', text: 'Secure Water Treatment', links: [] },
]);

test('recall@k and MRR follow the expected ids; misses are listed', () => {
  const bench = parseBench([
    { pregunta: 'resultado de GDN en SWaT', esperados: ['HE-1'] },
    { pregunta: 'USAD en WADI', esperados: ['HE-2', 'HE-3'] },
  ]);
  const report = evaluate((q, k) => search(index, q.pregunta, { k }), bench, 3);
  assert.equal(report.preguntas, 2);
  assert.equal(report.recallMedio, (1 + 0.5) / 2);
  assert.equal(report.mrr, 1);
  assert.deepEqual(report.fallos.map(f => f.faltan), [['HE-3']]);
});

test('a malformed bench is refused with the question number', () => {
  assert.throws(() => parseBench([{ pregunta: 'x', esperados: [] }]), /Pregunta 1/);
  assert.throws(() => parseBench({}), /lista/);
});
