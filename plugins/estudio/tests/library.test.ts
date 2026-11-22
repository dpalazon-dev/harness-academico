import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUploadService, safeName } from '../src/documents/subidas.ts';

function uploads(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-subidas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const incorporated: { file: string; title: string }[] = [];
  let n = 0;
  const service = createUploadService({
    partsDir: path.join(root, 'subidas'), libraryDir: path.join(root, 'biblioteca'), newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
    incorporate: (file, title) => { incorporated.push({ file, title }); return { id: 'doc1', title, status: 'procesando' }; },
  });
  /** Lo que hace la Biblioteca del armazón (`subirArchivo`): inicio, trozos en orden, fin; si algo falla, cancela. */
  async function subir(file: File, onProgress: (sent: number) => void) {
    const { uploadId, chunkBytes } = service.start({ name: file.name, bytes: file.size }) as { uploadId: string; chunkBytes: number };
    try {
      for (let index = 0, offset = 0; offset < file.size; index++, offset += chunkBytes) {
        const bytes = Buffer.from(await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer());
        service.chunk({ uploadId, index, data: bytes.toString('base64') });
        onProgress(Math.min(offset + chunkBytes, file.size));
      }
      return service.finish({ uploadId });
    } catch (error) {
      try { service.cancel({ uploadId }); } catch { /* ya no existe */ }
      throw error;
    }
  }
  return { root, service, subir, incorporated };
}

test('a PDF larger than one chunk arrives whole, is kept in the library and handed to Document Intelligence', async t => {
  const u = uploads(t);
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024, 7)]);
  const progress: number[] = [];
  const doc = await u.subir(new File([bytes], 'Deep Learning: libro.pdf'), sent => progress.push(sent));
  assert.equal((doc as { id: string }).id, 'doc1');
  assert.equal(progress.length, 2);
  assert.equal(progress.at(-1), bytes.length);
  const { file, title } = u.incorporated[0]!;
  assert.equal(title, 'Deep Learning: libro');
  assert.equal(path.basename(file), '00000000-Deep Learning_ libro.pdf');
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.deepEqual(fs.readdirSync(path.join(u.root, 'subidas')), []);
});

test('an upload that is not a PDF, or arrives out of order, is refused and leaves nothing behind', async t => {
  const u = uploads(t);
  await assert.rejects(u.subir(new File(['hola'], 'notas.pdf'), () => {}), /no es un PDF/);
  assert.throws(() => u.service.start({ name: 'notas.txt', bytes: 4 }), /Solo se incorporan archivos PDF/);
  const { uploadId } = u.service.start({ name: 'a.pdf', bytes: 10 });
  assert.throws(() => u.service.chunk({ uploadId, index: 1, data: 'AAAA' }), /Se esperaba el trozo 0/);
  assert.throws(() => u.service.chunk({ uploadId, index: 0, data: Buffer.alloc(11).toString('base64') }), /no cuadra/);
  assert.deepEqual(fs.readdirSync(path.join(u.root, 'subidas')), []);
  assert.deepEqual(u.incorporated, []);
  assert.equal(safeName('C:\\x\\..\\con:fuso?.PDF'), 'con_fuso_.pdf');
});
