import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentLinks, removeDocument } from '../src/documents/borrar.ts';
import { effectivePolicy, regulate } from '../src/practice/policy.ts';
import { taskRequest } from '../src/practice/prompts.ts';
import { openStudyStore } from '../src/study/store.ts';
import { NOW, unit } from './study-fixtures.ts';

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-borrar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = openStudyStore(path.join(root, 'study'));
  const libraryDir = path.join(root, 'biblioteca');
  fs.mkdirSync(libraryDir);
  const pdf = path.join(libraryDir, 'abc-Manual.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7');
  const doc = (o: Record<string, unknown> = {}) => ({
    id: 'd1', revision: 1, title: 'Manual', path: pdf, status: 'error' as const, error: 'falló', startedAt: NOW, finishedAt: NOW,
    original: null, doclingSha256: null, estructuraSha256: null, paginas: null, contraste: null, revisar: [], areaId: null, ...o,
  });
  return { root, store, libraryDir, pdf, doc };
}

test('removing a source unlinks units and notebooks, keeps the notes and moves record and uploaded PDF to the trash', t => {
  const f = setup(t);
  f.store.saveDocument(f.doc(), null);
  f.store.saveUnit(unit({ sources: [{ path: 'documento:d1', locator: '2' }, { path: 'C:/otro.pdf' }] }), null);
  f.store.saveNotebook({ id: 'n1', revision: 1, title: 'Notas del manual', kind: 'fuente', unitId: null, documentId: 'd1', createdAt: NOW, updatedAt: NOW, areaId: null,
    blocks: [{ id: 'b1', kind: 'nota', symbol: 'I', text: 'Idea', locator: 'p. 2', quote: 'Cita literal' }] }, null);
  assert.deepEqual(documentLinks(f.store, 'd1'), { units: [{ id: 'u1', title: 'Derivada como límite' }], notebooks: [{ id: 'n1', title: 'Notas del manual' }] });
  assert.throws(() => removeDocument(f.store, { id: 'd1', expectedRevision: 0 }, { libraryDir: f.libraryDir, now: () => NOW }), /cambió/);
  removeDocument(f.store, { id: 'd1', expectedRevision: 1 }, { libraryDir: f.libraryDir, now: () => NOW });
  assert.equal(f.store.getDocument('d1'), null);
  assert.deepEqual(f.store.getUnit('u1')!.sources, [{ path: 'C:/otro.pdf' }]);
  const nb = f.store.getNotebook('n1')!;
  assert.equal(nb.documentId, null);
  assert.equal(nb.blocks[0]!.kind === 'nota' && nb.blocks[0]!.quote, 'Cita literal');
  assert.ok(!fs.existsSync(f.pdf));
  assert.deepEqual(fs.readdirSync(path.join(f.libraryDir, '.papelera')), ['abc-Manual.pdf']);
  assert.equal(fs.readdirSync(path.join(f.root, 'study', 'documents', '.papelera')).length, 1);
});

test('a source still being incorporated is not removed, and a PDF outside the library is never moved', t => {
  const f = setup(t);
  f.store.saveDocument(f.doc({ status: 'procesando', error: null, finishedAt: null }), null);
  assert.throws(() => removeDocument(f.store, { id: 'd1', expectedRevision: 1 }, { libraryDir: f.libraryDir, now: () => NOW }), /Espera/);
  const outside = path.join(f.root, 'mis-libros.pdf');
  fs.writeFileSync(outside, '%PDF');
  f.store.saveDocument(f.doc({ id: 'd2', path: outside }), null);
  removeDocument(f.store, { id: 'd2', expectedRevision: 1 }, { libraryDir: f.libraryDir, now: () => NOW });
  assert.ok(fs.existsSync(outside));
});

test('the task request says what a correct answer must contain for the kind of knowledge, or asks the model to infer it', () => {
  assert.match(taskRequest(unit({ kind: 'procedimiento' }), 'aplicada', []), /Es un procedimiento: la tarea pide ejecutarlo/);
  assert.match(taskRequest(unit({ kind: 'concepto' }), 'libre', []), /lo distingue de los conceptos vecinos/);
  assert.match(taskRequest(unit({ kind: 'argumento' }), 'libre', []), /tesis, sus premisas, la evidencia/);
  assert.match(taskRequest(unit({ kind: 'modelo' }), 'estructural', []), /componentes y las relaciones/);
  assert.match(taskRequest(unit({ kind: null }), 'libre', []), /Tipo de conocimiento no indicado: dedúcelo/);
});

test('a procedure without an explicit policy is practised by executing it', () => {
  assert.equal(effectivePolicy({ kind: 'procedimiento', policy: null }), 'ejecutar');
  assert.equal(effectivePolicy({ kind: 'concepto', policy: null }), 'reconstruir');
  assert.equal(effectivePolicy({ kind: 'procedimiento', policy: 'recordar' }), 'recordar');
  assert.equal(regulate(unit({ kind: 'procedimiento', policy: null }), [], [], NOW, 'Europe/Madrid').nextTaskKind, 'aplicada');
});
