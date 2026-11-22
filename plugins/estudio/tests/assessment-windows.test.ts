import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAssessmentStore } from '../src/assessment/store.ts';
import { createAssessmentService } from '../src/assessment/service.ts';
import { syncDirectory } from '../src/assessment/files.ts';

function asPlatform(t: TestContext, platform: NodeJS.Platform) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  t.after(() => Object.defineProperty(process, 'platform', original));
}

function failDirectoryOpen(t: TestContext, code: string) {
  t.mock.method(fs, 'open', async () => { throw Object.assign(new Error(code), { code }); });
}

test('on win32, directories that cannot be opened for fsync are skipped', async t => {
  asPlatform(t, 'win32');
  for (const code of ['EPERM', 'EISDIR', 'EACCES']) {
    failDirectoryOpen(t, code);
    await syncDirectory(os.tmpdir());
    t.mock.restoreAll();
  }
});

test('elsewhere, an unsupported directory fsync still fails closed', async t => {
  asPlatform(t, 'linux');
  failDirectoryOpen(t, 'EPERM');
  await assert.rejects(syncDirectory(os.tmpdir()), /Durable directory synchronization/);
});

test('the service accepts IANA zone names and rejects offsets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tz-'));
  const store = await openAssessmentStore(root);
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const base = { now: () => '2026-11-11T10:00:00.000Z', id: () => 'x' };
  assert.doesNotThrow(() => createAssessmentService(store, { ...base, timeZone: 'America/Bogota' }));
  assert.throws(() => createAssessmentService(store, { ...base, timeZone: '+01:00' }), /IANA timezone/);
});

test('the assessment store opens, writes and reopens on this platform', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-assessment-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let ids = 0;
  const options = { now: () => '2026-11-11T10:00:00.000Z', id: () => `id-${++ids}`, timeZone: 'Europe/Madrid' };
  const store = await openAssessmentStore(root);
  const service = createAssessmentService(store, options);
  const created = await service.createCheck({
    id: 'check', operationId: 'create', expectedRevision: null,
    content: { title: 'T', objective: 'O', type: 'explain', prompt: 'P', reference: 'R', rubric: ['C'] },
  });
  assert.equal(created.id, 'check');
  await store.close();
  const reopened = await openAssessmentStore(root);
  try {
    const again = await createAssessmentService(reopened, options).getCheck('check');
    assert.equal(again.revision, created.revision);
  } finally { await reopened.close(); }
});
