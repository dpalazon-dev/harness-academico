import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { exportAssessment, restoreAssessment, serializeAssessmentBackup, assessmentBackupMarkdown, type AssessmentBackup } from '../src/assessment/backup.ts';
import { openAssessmentStore, type AssessmentFileStore } from '../src/assessment/store.ts';
import { createAssessmentService } from '../src/assessment/service.ts';
import type { AttemptAggregate, CheckRecord } from '../src/assessment/types.ts';

const at = '2026-01-10T12:00:00.000Z';
const created = '2026-01-01T12:00:00.000Z';
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, expected); return true; };
const content = { title: 'Synthetic', objective: 'Explain', type: 'explain' as const, prompt: 'Question', reference: '</script>\n```\n<script>untrusted</script>', rubric: ['Criterion'] };
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}
function signed(value: AssessmentBackup): string {
  const { checksum: _checksum, ...payload } = value;
  return JSON.stringify({ ...payload, checksum: createHash('sha256').update(canonical(payload)).digest('hex') });
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'assessment-backup-'));
  const root = path.join(parent, 'source'); const target = path.join(parent, 'target');
  await fs.mkdir(target);
  const stores: AssessmentFileStore[] = [];
  const open = async (selected = root) => { const store = await openAssessmentStore(selected); stores.push(store); return store; };
  t.after(async () => { try { for (const store of stores) await store.close(); } finally { await fs.rm(parent, { recursive: true, force: true }); } });
  const store = await open(); let sequence = 0;
  const service = createAssessmentService(store, { now: () => created, id: () => `internal_${++sequence}`, timeZone: 'Europe/Madrid' });
  const draft = await service.createCheck({ id: 'check', operationId: 'create', expectedRevision: null, content });
  const check = await service.activateCheck({ id: 'check', operationId: 'activate', expectedRevision: draft.revision });
  const opening = { id: 'attempt', operationId: 'open', expectedRevision: null, checkId: 'check', checkExpectedRevision: check.revision, episodeId: 'episode', confidence: 80, help: 'none' } as const;
  return { parent, root, target, store, service, opening, open };
}
const exportOptions = () => { let sequence = 0; return { now: () => at, id: () => `backup_exposure_${++sequence}` }; };

test('offline roundtrip preserves complete envelopes, episodes, revisions, frozen answers, corrections and receipt replay', async t => {
  const f = await fixture(t);
  const opened = await f.service.openAttempt(f.opening);
  const saved = await f.service.commandAttempt({ id: opened.id, operationId: 'save', expectedRevision: opened.revision, command: { type: 'saveAnswer', answer: 'Immutable answer' } });
  const frozen = await f.service.commandAttempt({ id: opened.id, operationId: 'freeze', expectedRevision: saved.revision, command: { type: 'freeze' } });
  const graded = await f.service.commandAttempt({ id: opened.id, operationId: 'grade', expectedRevision: frozen.revision, command: { type: 'grade', score: 'fluent', marks: ['met'], diagnosis: 'Original' } });
  await f.service.commandAttempt({ id: opened.id, operationId: 'correct', expectedRevision: graded.revision, command: { type: 'correctGrade', score: 'cant', marks: ['missing'], diagnosis: 'Correction' } });
  const before = await f.service.getCheck('check');
  await f.service.reviseCheck({ id: 'check', operationId: 'revise', expectedRevision: before.revision, content: { ...content, prompt: 'Second revision' } });
  const attemptBytes = await fs.readFile(path.join(f.root, 'attempts', 'attempt.json'), 'utf8');
  await f.store.close();
  const backup = await exportAssessment(f.root, exportOptions());
  assert.equal(backup.checks[0]!.record.lastExposedAt, at);
  assert.equal(backup.checks[0]!.record.revision, before.revision + 2);
  assert.equal(backup.checks[0]!.record.revisions.length, 2);
  assert.equal(backup.attempts[0]!.record.episodeId, 'episode');
  assert.equal(backup.attempts[0]!.record.grades.length, 2);
  assert.equal(await fs.readFile(path.join(f.root, 'attempts', 'attempt.json'), 'utf8'), attemptBytes);
  const report = await restoreAssessment(serializeAssessmentBackup(backup), f.target);
  assert.deepEqual(report, { root: f.target, checks: 1, attempts: 1, checksum: backup.checksum });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.target, 'checks', 'check.json'), 'utf8')), backup.checks[0]!);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.target, 'attempts', 'attempt.json'), 'utf8')), backup.attempts[0]!);
  const source = await f.open(); const restored = await f.open(f.target);
  const options = { now: () => at, id: () => 'unused', timeZone: 'Europe/Madrid' };
  const sourceService = createAssessmentService(source, options); const restoredService = createAssessmentService(restored, options);
  assert.deepEqual(await restoredService.history('check'), await sourceService.history('check'));
  assert.deepEqual(await restoredService.queue(), await sourceService.queue());
  const replay = await restored.commit<CheckRecord>('checks', 'check', { operationId: 'create', expectedRevision: null, requestHash: backup.checks[0]!.receipts.find(r => r.operationId === 'create')!.requestHash }, () => { throw new Error('receipt replay must not transform'); });
  assert.deepEqual(replay, backup.checks[0]!.record);
});

test('open attempts and active writers block export before exposure', async t => {
  const f = await fixture(t); await assert.rejects(exportAssessment(f.root, exportOptions()), code('STORE_LOCKED'));
  await f.service.openAttempt(f.opening); const before = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  await f.store.close(); await assert.rejects(exportAssessment(f.root, exportOptions()), code('INVALID_TRANSITION'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
});

test('export preflight rejects backwards clocks, duplicate exposure IDs and exhausted receipts without writes', async t => {
  const f = await fixture(t); await f.store.close(); const file = path.join(f.root, 'checks', 'check.json'); const before = await fs.readFile(file, 'utf8');
  await assert.rejects(exportAssessment(f.root, { now: () => '2025-01-01T00:00:00.000Z', id: () => 'new' }));
  await assert.rejects(exportAssessment(f.root, { now: () => at, id: () => 'create' }), code('CONFLICT'));
  assert.equal(await fs.readFile(file, 'utf8'), before);
  const envelope = JSON.parse(before); envelope.receipts = Array.from({ length: 10000 }, (_, i) => ({ operationId: `receipt_${i}`, requestHash: 'hash' })); await fs.writeFile(file, JSON.stringify(envelope));
  const full = await fs.readFile(file, 'utf8'); await assert.rejects(exportAssessment(f.root, exportOptions()), code('LIMIT_EXCEEDED')); assert.equal(await fs.readFile(file, 'utf8'), full);
});

test('exposure write failure returns no backup and does not change attempts', async t => {
  const f = await fixture(t); const opened = await f.service.openAttempt(f.opening); await f.service.commandAttempt({ id: opened.id, operationId: 'abandon', expectedRevision: opened.revision, command: { type: 'abandon' } }); await f.store.close();
  const before = await fs.readFile(path.join(f.root, 'attempts', 'attempt.json'), 'utf8');
  t.mock.method(fs, 'rename', async () => { throw new Error('synthetic export failure'); });
  await assert.rejects(exportAssessment(f.root, exportOptions()), /synthetic export failure/);
  assert.equal(await fs.readFile(path.join(f.root, 'attempts', 'attempt.json'), 'utf8'), before);
});

test('entire serialized input is validated before any target writes', async t => {
  const f = await fixture(t); await f.store.close(); const valid = await exportAssessment(f.root, exportOptions());
  const invalid: Array<string | Uint8Array> = ['{broken', new Uint8Array([0xff]), JSON.stringify({ ...valid, formatVersion: 2 }), JSON.stringify({ ...valid, provider: 'forbidden' }), JSON.stringify({ ...valid, checksum: '0'.repeat(64) }), ' '.repeat(50 * 1024 * 1024 + 1)];
  const duplicate = structuredClone(valid); duplicate.checks.push(structuredClone(duplicate.checks[0]!)); invalid.push(signed(duplicate));
  const collision = structuredClone(valid); collision.checks.push(structuredClone(collision.checks[0]!)); collision.checks[1]!.record.id = 'CHECK'; invalid.push(signed(collision));
  const reserved = structuredClone(valid); reserved.checks[0]!.record.id = 'CON'; invalid.push(signed(reserved));
  const receipts = structuredClone(valid); receipts.checks[0]!.receipts.push(structuredClone(receipts.checks[0]!.receipts[0]!)); invalid.push(signed(receipts));
  const future = structuredClone(valid); future.checks[0]!.record.updatedAt = '2027-01-01T00:00:00.000Z'; invalid.push(signed(future));
  invalid.push('['.repeat(33) + '0' + ']'.repeat(33));
  for (const value of invalid) { await assert.rejects(restoreAssessment(value, f.target)); assert.deepEqual(await fs.readdir(f.target), []); }
  await assert.rejects(restoreAssessment(valid as unknown as string, f.target)); assert.deepEqual(await fs.readdir(f.target), []);
});

test('cross-record snapshot tampering is rejected even with a recomputed checksum', async t => {
  const f = await fixture(t); const opened = await f.service.openAttempt(f.opening); await f.service.commandAttempt({ id: opened.id, operationId: 'freeze', expectedRevision: opened.revision, command: { type: 'freeze' } }); await f.store.close();
  const valid = await exportAssessment(f.root, exportOptions());
  for (const mutate of [(row: AttemptAggregate) => { row.snapshot.reference = 'forged'; }, (row: AttemptAggregate) => { row.checkId = 'missing'; }, (row: AttemptAggregate) => { row.snapshot.activatedAt = null; }]) {
    const invalid = structuredClone(valid); mutate(invalid.attempts[0]!.record); await assert.rejects(restoreAssessment(signed(invalid), f.target)); assert.deepEqual(await fs.readdir(f.target), []);
  }
});

test('draft snapshots can predate activation of identical evaluable content', async t => {
  const f = await fixture(t); const opened = await f.service.openAttempt(f.opening); await f.service.commandAttempt({ id: opened.id, operationId: 'abandon', expectedRevision: opened.revision, command: { type: 'abandon' } }); await f.store.close();
  const backup = await exportAssessment(f.root, exportOptions()); backup.attempts[0]!.record.snapshot.reviewed = false; backup.attempts[0]!.record.snapshot.activatedAt = null;
  await restoreAssessment(signed(backup), f.target); assert.equal(JSON.parse(await fs.readFile(path.join(f.target, 'attempts', 'attempt.json'), 'utf8')).record.snapshot.reviewed, false);
});

test('cumulative record and individual envelope limits reject before target writes', async t => {
  const f = await fixture(t); const opened = await f.service.openAttempt(f.opening); const frozen = await f.service.commandAttempt({ id: opened.id, operationId: 'freeze', expectedRevision: opened.revision, command: { type: 'freeze' } });
  await f.service.commandAttempt({ id: opened.id, operationId: 'grade', expectedRevision: frozen.revision, command: { type: 'grade', score: 'cant', marks: ['missing'], diagnosis: '' } }); await f.store.close();
  const valid = await exportAssessment(f.root, exportOptions());
  const count = structuredClone(valid); const first = count.attempts[0]!.record.grades[0]!; count.attempts[0]!.record.grades = Array.from({ length: 49998 }, (_, index) => ({ ...first, correction: index > 0 }));
  await assert.rejects(restoreAssessment(signed(count), f.target), code('LIMIT_EXCEEDED')); assert.deepEqual(await fs.readdir(f.target), []);
  const bytes = structuredClone(valid); const revision = bytes.checks[0]!.record.revisions[0]!; bytes.checks[0]!.record.revisions = Array.from({ length: 90 }, (_, index) => ({ ...revision, revision: index + 1, reference: 'x'.repeat(100000) }));
  await assert.rejects(restoreAssessment(signed(bytes), f.target), code('LIMIT_EXCEEDED')); assert.deepEqual(await fs.readdir(f.target), []);
});

test('partial restore leaves a refusal marker, releases only its lock and leaves active source unchanged', async t => {
  const f = await fixture(t); await f.store.close(); const backup = await exportAssessment(f.root, exportOptions()); const before = await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8');
  const rename = t.mock.method(fs, 'rename', async () => { throw new Error('synthetic staging failure'); });
  await assert.rejects(restoreAssessment(serializeAssessmentBackup(backup), f.target), /synthetic staging failure/); rename.mock.restore();
  assert.ok((await fs.readdir(f.target)).includes('.assessment-restore-incomplete'));
  assert.ok(!(await fs.readdir(f.target)).includes('.assessment-store.lock'));
  await assert.rejects(openAssessmentStore(f.target), code('INVALID_TRANSITION'));
  assert.equal(await fs.readFile(path.join(f.root, 'checks', 'check.json'), 'utf8'), before);
});

test('nonempty, symlink and locked targets are rejected without replacement', async t => {
  const f = await fixture(t); await f.store.close(); const backup = serializeAssessmentBackup(await exportAssessment(f.root, exportOptions()));
  await fs.writeFile(path.join(f.target, 'keep'), 'preserve'); await assert.rejects(restoreAssessment(backup, f.target)); assert.equal(await fs.readFile(path.join(f.target, 'keep'), 'utf8'), 'preserve');
  const linked = path.join(f.parent, 'linked'); await fs.symlink(f.target, linked, 'dir'); await assert.rejects(restoreAssessment(backup, linked), code('INVALID_INPUT'));
  const locked = path.join(f.parent, 'locked'); await fs.mkdir(locked); await fs.writeFile(path.join(locked, '.assessment-store.lock'), 'owner'); await assert.rejects(restoreAssessment(backup, locked)); assert.equal(await fs.readFile(path.join(locked, '.assessment-store.lock'), 'utf8'), 'owner');
});

test('release-only failure rejects after complete recovery without writing a marker after losing the lease', async t => {
  const f = await fixture(t); await f.store.close(); const backup = await exportAssessment(f.root, exportOptions());
  const originalOpen = fs.open.bind(fs);
  const openMock = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.target && (await handle.stat()).isDirectory()) {
      const originalSync = handle.sync.bind(handle);
      t.mock.method(handle, 'sync', async () => {
        const entries = await fs.readdir(f.target);
        if (entries.includes('checks') && !entries.includes('.assessment-store.lock') && !entries.includes('.assessment-restore-incomplete')) throw new Error('synthetic release-only failure');
        await originalSync();
      });
    }
    return handle;
  });
  await assert.rejects(restoreAssessment(serializeAssessmentBackup(backup), f.target), /synthetic release-only failure/); openMock.mock.restore();
  assert.deepEqual((await fs.readdir(f.target)).sort(), ['attempts', 'checks']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.target, 'checks', 'check.json'), 'utf8')), backup.checks[0]!);
});

test('Markdown keeps all untrusted text inside an unclosable fence and validates its input', async t => {
  const f = await fixture(t); await f.store.close(); const backup = await exportAssessment(f.root, exportOptions()); const markdown = assessmentBackupMarkdown(backup);
  const fence = markdown.split('\n').find(line => /^`{4,}json$/.test(line)); assert.ok(fence); const delimit = fence.slice(0, -4); assert.equal(markdown.split('\n').filter(line => line === delimit).length, 1);
  assert.ok(markdown.includes(content.reference.replaceAll('\n', '\\n'))); assert.throws(() => serializeAssessmentBackup({ ...backup, checksum: 'bad' }));
});
