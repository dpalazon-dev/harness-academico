import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStudyStore } from '../src/study/store.ts';
import { createNotebookService } from '../src/notebooks/service.ts';
import { ankiExport, notebookMarkdown, parseNotebook, type Notebook } from '../src/notebooks/types.ts';
import { tempStore, unit, NOW } from './study-fixtures.ts';

function service(t: Parameters<typeof tempStore>[0]) {
  const store = tempStore(t);
  let n = 0;
  return { store, s: createNotebookService(store, { now: () => NOW, newId: () => `id${++n}` }) };
}

const doc = (id = 'd1') => ({
  id, revision: 1, title: 'Manual de ML', path: 'C:/x.pdf', status: 'procesando' as const, error: null, startedAt: NOW, finishedAt: null,
  original: null, doclingSha256: null, estructuraSha256: null, paginas: null, contraste: null, revisar: [], areaId: null,
});

test('a notebook is created, saved with its blocks and refuses a stale revision', t => {
  const { store, s } = service(t);
  store.saveUnit(unit(), null);
  const nb = s.create({ title: 'Embeddings', kind: 'conocimiento', unitId: 'u1' });
  const blocks = [
    { id: 'b1', kind: 'nota', symbol: 'Δ', text: 'Antes creía que eran one-hot; ahora sé que son densos.', locator: '', quote: '' },
    { id: 'b2', kind: 'error', wrong: 'Embedding = one-hot', cause: 'Confundí la entrada con la representación', fix: 'Es un vector denso aprendido' },
    { id: 'b3', kind: 'recuperacion', question: '¿Qué es un embedding?', answer: 'Un vector denso aprendido que representa un ítem.' },
  ];
  const saved = s.save({ id: nb.id, expectedRevision: 1, title: 'Embeddings', kind: 'conocimiento', unitId: 'u1', documentId: null, blocks });
  assert.equal(saved.revision, 2);
  assert.equal(saved.blocks.length, 3);
  assert.throws(() => s.save({ id: nb.id, expectedRevision: 1, title: 'X', kind: 'libre', unitId: null, documentId: null, blocks: [] }), /cambió mientras tanto/);
  assert.throws(() => s.save({ id: nb.id, expectedRevision: 2, title: 'X', kind: 'libre', unitId: null, documentId: null, blocks: [{ id: 'z', kind: 'nota', symbol: 'Q', text: '', locator: '', quote: '' }] }), /known symbol/);
  assert.deepEqual(s.question({ notebookId: nb.id, blockId: 'b3' }), { unitId: 'u1', question: '¿Qué es un embedding?', answer: 'Un vector denso aprendido que representa un ítem.' });
  assert.equal(s.searchDocs()[0]!.kind, 'nota');
  assert.match(s.searchDocs()[0]!.text, /Δ Antes creía/);
});

test('a passage from the reader goes to the source note of its document, with its page and quote', t => {
  const { store, s } = service(t);
  store.saveDocument(doc(), null);
  const first = s.notePassage({ documentId: 'd1', page: 2, quote: 'Los embeddings capturan similitud.' });
  const second = s.notePassage({ documentId: 'd1', page: 3, quote: 'El producto escalar mide afinidad.' });
  assert.equal(first.id, second.id);
  assert.equal(second.kind, 'fuente');
  assert.equal(second.title, 'Manual de ML');
  assert.deepEqual(second.blocks.map(b => b.kind === 'nota' && [b.locator, b.quote, b.text]), [['p. 2', 'Los embeddings capturan similitud.', ''], ['p. 3', 'El producto escalar mide afinidad.', '']]);
});

test('a trashed notebook leaves the app but stays on disk; a question needs a unit and both texts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-nb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = createNotebookService(openStudyStore(root), { now: () => NOW, newId: () => 'nb1' });
  const nb = s.create({ title: 'Suelto', kind: 'libre' });
  const withQ = s.save({ id: nb.id, expectedRevision: 1, title: 'Suelto', kind: 'libre', unitId: null, documentId: null, blocks: [{ id: 'q', kind: 'recuperacion', question: '¿Por qué?', answer: 'Porque sí.' }] });
  assert.throws(() => s.question({ notebookId: nb.id, blockId: 'q' }), /Vincula el cuaderno/);
  s.trash({ id: nb.id, expectedRevision: withQ.revision });
  assert.deepEqual(s.list(), []);
  assert.equal(fs.readdirSync(path.join(root, 'notebooks', '.papelera')).length, 1);
});

const NB: Notebook = parseNotebook({
  id: 'n1', revision: 1, title: 'Factorización', kind: 'fuente', unitId: null, documentId: null, createdAt: NOW, updatedAt: NOW,
  blocks: [
    { id: 'a', kind: 'nota', symbol: '≠', text: 'Factorización ≠ SVD exacta', locator: 'p. 4', quote: 'We approximate R' },
    { id: 'b', kind: 'recuperacion', question: '¿Qué minimiza?', answer: 'El error\tcuadrático\nregularizado' },
    { id: 'c', kind: 'recuperacion', question: 'Sin respuesta', answer: '' },
  ],
});

test('Markdown keeps the notation and quotes; Anki gets only complete questions, with a stable id', () => {
  assert.match(notebookMarkdown(NB, { document: 'Koren 2009' }), /# Factorización\n\n\*Nota de fuente\* · fuente: Koren 2009\n\n- ≠ Factorización ≠ SVD exacta \(p\. 4\)\n  > We approximate R\n- Pregunta: ¿Qué minimiza\?/);
  const out = ankiExport([NB]);
  assert.equal(out.count, 1);
  assert.match(out.text, /^#separator:tab\n#html:true\n#guid column:1\n#tags column:4\n/);
  assert.match(out.text, /estudio-b\t¿Qué minimiza\?\tEl error cuadrático<br>regularizado\testudio Factorizacion\n$/);
});

test('los límites de la página que David puede alcanzar se dicen en español', t => {
  const { s } = service(t);
  const nb = s.create({ title: 'Límites', kind: 'libre' });
  const nota = (i: number, text = 'x') => ({ id: `n${i}`, kind: 'nota', symbol: null, text, locator: '', quote: '' });
  const guardar = (blocks: unknown[], title = 'Límites') => () => s.save({ id: nb.id, expectedRevision: 1, title, kind: 'libre', unitId: null, documentId: null, blocks });
  assert.throws(guardar([nota(1, 'a'.repeat(8001))]), /Un párrafo admite hasta 8000 caracteres: divídelo en varios/);
  assert.throws(guardar([{ id: 'e1', kind: 'error', wrong: 'a'.repeat(8001), cause: '', fix: '' }]), /admite hasta 8000 caracteres/);
  assert.throws(guardar(Array.from({ length: 501 }, (_, i) => nota(i))), /Un cuaderno admite hasta 500 bloques/);
  assert.throws(guardar([nota(1)], 'T'.repeat(301)), /título admite hasta 300 caracteres: acórtalo/);
  assert.equal(guardar(Array.from({ length: 500 }, (_, i) => nota(i)))().blocks.length, 500, 'justo en el límite se guarda');
});
