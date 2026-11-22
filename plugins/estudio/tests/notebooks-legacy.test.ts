import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStudyStore } from '../src/study/store.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import { notebookMarkdown } from '../src/notebooks/types.ts';
import { NOW, LATER } from './study-fixtures.ts';

/** Cuadernos escritos con el editor de bloques (formas copiadas de los datos de prueba reales): una nota de fuente
 * traída del lector (cita y localizador, sin texto), notas con símbolo, un error y preguntas de recuperación. */
const ANTIGUOS = [
  {
    id: 'fuente', revision: 4, title: 'Taxonomía de anomalías', kind: 'fuente', unitId: null, documentId: null, createdAt: NOW, updatedAt: NOW, areaId: null,
    blocks: [
      { id: 'q1', kind: 'nota', symbol: null, text: '', locator: 'p. 1', quote: 'Las anomalías pueden proceder de instrumentación.' },
      { id: 'q2', kind: 'nota', symbol: '≠', text: 'Fallo de sensor ≠ ataque', locator: 'p. 2', quote: 'Sus manifestaciones pueden ser similares.' },
    ],
  },
  {
    id: 'libre', revision: 2, title: 'Dijkstra', kind: 'libre', unitId: null, documentId: null, createdAt: NOW, updatedAt: NOW, areaId: null,
    blocks: [
      { id: 'n1', kind: 'nota', symbol: '→', text: 'Relaja aristas en orden de distancia', locator: '', quote: '' },
      { id: 'n2', kind: 'nota', symbol: null, text: 'I think the greedy choice is safe.', locator: '', quote: '' },
      { id: 'r1', kind: 'recuperacion', question: '¿Por qué falla con pesos negativos?', answer: 'Porque fija la distancia al extraer el vértice.' },
      { id: 'e1', kind: 'error', wrong: 'Funciona con pesos negativos', cause: 'Lo confundí con Bellman-Ford', fix: 'Exige pesos no negativos' },
    ],
  },
  { id: 'vacio', revision: 1, title: 'Cuaderno sin título', kind: 'sintesis', unitId: null, documentId: null, createdAt: NOW, updatedAt: NOW, areaId: null, blocks: [] },
];

function conAntiguos(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-nb-antiguos-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'notebooks'), { recursive: true });
  for (const nb of ANTIGUOS) fs.writeFileSync(path.join(root, 'notebooks', `${nb.id}.json`), JSON.stringify(nb, null, 2));
  const store = openStudyStore(root);
  return createNotebookService(store, { now: () => LATER, newId: () => 'nuevo' });
}

test('los cuadernos antiguos se leen tal cual, sin migrar: mismos bloques, símbolo, cita y localizador', t => {
  const s = conAntiguos(t);
  const leidos = new Map(s.list().map(nb => [nb.id, nb]));
  for (const antiguo of ANTIGUOS) assert.deepEqual(leidos.get(antiguo.id), antiguo, antiguo.title);
});

test('guardar un cuaderno antiguo sin cambiarlo conserva sus bloques y su exportación', t => {
  const s = conAntiguos(t);
  const antes = s.list().find(nb => nb.id === 'libre')!;
  const md = s.markdown({ id: 'libre' }).text;
  const guardado = s.save({ id: antes.id, expectedRevision: antes.revision, title: antes.title, kind: antes.kind, unitId: null, documentId: null, blocks: antes.blocks });
  assert.deepEqual(guardado.blocks, antes.blocks);
  assert.equal(s.markdown({ id: 'libre' }).text, md);
  assert.equal(md, notebookMarkdown(antes));
});
