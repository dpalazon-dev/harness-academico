import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocumentService, documentConfig } from '../src/documents/incorporar.ts';
import { ORIGINAL_SHA, tempAlmacen } from './documents-fixtures.ts';
import { tempStore } from './study-fixtures.ts';

const realSpawn = childProcess.spawn;

/** Replaces `uv` with a Node script that behaves like `python -m di incorporar`: the external process is the boundary mocked. */
function fakeDi(t: TestContext, behaviour: { stdout?: string; stderr?: string; code?: number }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-fakedi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'di.mjs');
  fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(behaviour.stdout ?? '')}); process.stderr.write(${JSON.stringify(behaviour.stderr ?? '')}); process.exit(${behaviour.code ?? 0});`);
  const calls: { command: string; args: string[]; cwd: string; almacen: string }[] = [];
  const fake = (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => {
    calls.push({ command, args, cwd: options.cwd, almacen: options.env.KBOL_ALMACEN! });
    return realSpawn(process.execPath, [script], { ...options, cwd: dir } as childProcess.SpawnOptions);
  };
  t.mock.method(childProcess, 'spawn', fake as never);
  return calls;
}

function setup(t: TestContext, behaviour: Parameters<typeof fakeDi>[1] | ((estructuraSha: string) => Parameters<typeof fakeDi>[1])) {
  const { almacen, estructuraSha } = tempAlmacen(t);
  const calls = fakeDi(t, typeof behaviour === 'function' ? behaviour(estructuraSha) : behaviour);
  const store = tempStore(t);
  const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-pdf-')), 'Paper GNN.pdf');
  fs.writeFileSync(pdf, '%PDF');
  const kbol = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-kbol-'));
  fs.mkdirSync(path.join(kbol, 'tools', 'di'), { recursive: true });
  let n = 0, changes = 0;
  const service = () => createDocumentService(store, {
    config: { ...documentConfig({} as NodeJS.ProcessEnv, 'C:/home'), kbolDir: kbol, almacen }, now: () => new Date(Date.UTC(2026, 10, 11, 10, n)).toISOString(),
    newId: () => `doc${++n}`, signal: new AbortController().signal, onChange: () => { changes++; },
  });
  return { store, calls, pdf, service, estructuraSha, kbol, changes: () => changes };
}

const OUTPUT = (estructuraSha: string) => JSON.stringify({
  original: { sha256: ORIGINAL_SHA, bytes: 22 }, docling: { sha256: 'b'.repeat(64), paginas: 2 }, estructura: { sha256: estructuraSha },
  contraste: { resumen: { recuerdo_documento: 0.99, respaldo_documento: 0.98, paginas_sin_capa_de_texto: [] } }, revisar: ['página 1'],
});

test('a PDF is incorporated in the background and becomes ready with its hashes and contrast', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  assert.equal(doc.status, 'procesando');
  assert.equal(doc.title, 'Paper GNN');
  await s.idle();
  const ready = f.store.getDocument(doc.id)!;
  assert.equal(ready.status, 'listo');
  assert.equal(ready.estructuraSha256, f.estructuraSha);
  assert.deepEqual(ready.contraste, { recuerdo: 0.99, respaldo: 0.98, paginasSinTexto: [] });
  assert.deepEqual(f.calls[0]!.args, ['run', '--no-sync', 'python', '-m', 'di', 'incorporar', f.pdf]);
  assert.equal(f.calls[0]!.cwd, path.join(f.kbol, 'tools', 'di'));
  assert.equal(f.changes(), 1);
});

test('a failing run leaves the document in error with the last lines of its log', async t => {
  const f = setup(t, { code: 1, stderr: 'Traceback...\nRuntimeError: PDF sin capa de texto' });
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  const failed = f.store.getDocument(doc.id)!;
  assert.equal(failed.status, 'error');
  assert.match(failed.error!, /código 1:.*PDF sin capa de texto/s);
  assert.equal(failed.estructuraSha256, null);
});

test('output without the expected hashes, or a structure missing from the store, is an error', async t => {
  const f = setup(t, { stdout: '{"original": {}}' });
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  assert.match(f.store.getDocument(doc.id)!.error!, /salida no válida/);
  const g = setup(t, { stdout: OUTPUT('c'.repeat(64)) });
  const s2 = g.service();
  const doc2 = s2.incorporate({ path: g.pdf });
  await s2.idle();
  assert.match(g.store.getDocument(doc2.id)!.error!, /no está en el almacén/);
});

test('an incorporation interrupted by a restart is marked as an error, not left processing forever', t => {
  const f = setup(t, { stdout: '' });
  f.store.saveDocument({ id: 'old', revision: 1, title: 'x', path: f.pdf, status: 'procesando', error: null, startedAt: '2026-11-11T09:00:00.000Z', finishedAt: null, original: null, doclingSha256: null, estructuraSha256: null, paginas: null, contraste: null, revisar: [], areaId: null }, null);
  f.service();
  assert.match(f.store.getDocument('old')!.error!, /interrumpida/);
});

test('detail summarises the structure for orientation and verify checks quotes and the original', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  const detail = s.detail({ id: doc.id });
  assert.deepEqual(detail.secciones.map(x => [x.numero, x.tipo]), [['1', 'introduccion'], ['2', 'metodo']]);
  assert.deepEqual(detail.tablas.map(x => x.leyenda), ['Table 1: Results on SWaT']);
  assert.deepEqual(detail.figuras.map(x => x.leyenda), ['Figure 1: Architecture']);
  assert.equal(detail.referencias.length, 1);
  assert.equal(s.verify({ documentId: doc.id, page: 1, quote: 'water treatment plants' }).estado, 'resuelta');
  assert.equal(s.verify({ documentId: doc.id, page: 2, quote: 'water treatment plants' }).estado, 'rota');
  assert.match(s.excerpt(doc.id, undefined, 1000)!, /Anomaly detection/);
  assert.match(s.excerpt(doc.id, '2', 1000)!, /graph neural/);
  assert.equal(s.excerpt(doc.id, undefined, 10)!.endsWith('[…]'), true);
});

test('a page lists its sections, tables and figures in order, with headings, and refuses pages that do not exist', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  const page = s.page({ id: doc.id, page: 1 });
  assert.deepEqual([page.page, page.total, page.title], [1, 2, 'Paper GNN']);
  assert.deepEqual(page.blocks.map(b => [b.kind, b.heading]), [['seccion', '1 Introduction'], ['tabla', 'Table 1: Results on SWaT']]);
  assert.match(page.blocks[0]!.text, /water treatment plants/);
  assert.throws(() => s.page({ id: doc.id, page: 3 }), /entre 1 y 2/);
});

test('only absolute paths to existing PDF files are accepted', async t => {
  const f = setup(t, { stdout: '' });
  const s = f.service();
  assert.throws(() => s.incorporate({ path: 'paper.pdf' }), /ruta completa/);
  assert.throws(() => s.incorporate({ path: f.pdf.replace('.pdf', '.docx') }), /Solo se incorporan archivos PDF/);
  assert.throws(() => s.incorporate({ path: path.join(path.dirname(f.pdf), 'missing.pdf') }), /No existe/);
  assert.equal(s.incorporate({ path: `"${f.pdf}"` }).path, f.pdf);
  await s.idle();
});

test('nothing is spawned once the plugin has been deactivated', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const controller = new AbortController();
  controller.abort();
  const { runIncorporar } = await import('../src/documents/incorporar.ts');
  await assert.rejects(runIncorporar(f.pdf, documentConfig({} as NodeJS.ProcessEnv), controller.signal), /desactivado/);
  assert.equal(f.calls.length, 0);
});

test('one failed save does not stop the incorporations queued after it', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  const first = s.incorporate({ path: f.pdf });
  const second = s.incorporate({ path: f.pdf });
  const save = f.store.saveDocument;
  let failures = 0;
  t.mock.method(f.store, 'saveDocument', (doc: Parameters<typeof save>[0], expected: number | null) => {
    if (doc.id === first.id && doc.status === 'listo' && failures++ === 0) throw new Error('disco lleno');
    return save(doc, expected);
  });
  await s.idle();
  assert.match(f.store.getDocument(first.id)!.error!, /No se pudo guardar el resultado: disco lleno/);
  assert.equal(f.store.getDocument(second.id)!.status, 'listo');
});

test('stdout noise before the JSON is skipped, and a structure of another original is rejected', async t => {
  const { parseIncorporarStdout } = await import('../src/documents/incorporar.ts');
  assert.equal(parseIncorporarStdout(`Downloading model...\n{\n "original": {"sha256": "${'a'.repeat(64)}", "bytes": 1},\n "estructura": {"sha256": "${'b'.repeat(64)}"}\n}\n`).original.bytes, 1);
  const f = setup(t, sha => ({ stdout: OUTPUT(sha).replace(ORIGINAL_SHA, 'd'.repeat(64)) }));
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  assert.match(f.store.getDocument(doc.id)!.error!, /no deriva de este original/);
});

test('network paths are refused and a missing section or document never yields an ungrounded excerpt', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  assert.throws(() => s.incorporate({ path: String.raw`\\server\share\paper.pdf` }), /rutas de red/);
  assert.throws(() => s.incorporate({ path: '//server/share/paper.pdf' }), /rutas de red/);
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  assert.throws(() => s.excerpt(doc.id, '9', 1000), /sección 9 no existe/);
  assert.throws(() => s.excerpt('missing', undefined, 1000), /no está disponible/);
});

test('a page locator ("p. 2", as the reader shows passages) selects the sections on that page, and linking rejects a locator that matches nothing', async t => {
  const f = setup(t, sha => ({ stdout: OUTPUT(sha) }));
  const s = f.service();
  const doc = s.incorporate({ path: f.pdf });
  await s.idle();
  assert.match(s.excerpt(doc.id, 'p. 2', 1000), /graph neural/);
  assert.match(s.excerpt(doc.id, 'pág. 2', 1000), /graph neural/);
  assert.doesNotMatch(s.excerpt(doc.id, 'p. 2', 1000), /Anomaly detection/);
  assert.throws(() => s.excerpt(doc.id, 'p. 9', 1000), /página 9 no tiene secciones/);
  assert.doesNotThrow(() => s.checkLocator(doc.id, '2'));
  assert.doesNotThrow(() => s.checkLocator(doc.id, 'p. 1'));
  assert.throws(() => s.checkLocator(doc.id, 'cap. 24'), /sección cap\. 24 no existe/);
  assert.doesNotThrow(() => s.checkLocator('missing', '3'), 'an unreadable document is reported when practising, not when linking');
});
