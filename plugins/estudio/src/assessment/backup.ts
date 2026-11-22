import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseAttempt, parseCheck, validateInstant } from './schema.ts';
import type { AttemptAggregate, CheckRecord, CheckRevision } from './types.ts';
import {
  MAX_FILE_BYTES, MAX_RECEIPTS, absoluteRoot, assertDirectoryIdentity, assertHash,
  assertId, assertJson, exactKeys, fail, isMissing, plainObject, readBounded,
  readEnvelope, safeDirectory, sameFile, syncDirectory, unlinkOwned, validateRecord,
  writeAtomic, type Envelope, type VersionedRecord,
} from './files.ts';
import { acquireWriter, type WriterLease } from './lock.ts';

export interface AssessmentBackup {
  formatVersion: 1;
  createdAt: string;
  timeZone: 'Europe/Madrid';
  checks: Envelope<CheckRecord>[];
  attempts: Envelope<AttemptAggregate>[];
  checksum: string;
}
export interface RestoreReport { root: string; checks: number; attempts: number; checksum: string }
export interface AssessmentExportOptions { now: () => string; id: () => string }

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_RECORDS = 50000;
const MARKER = '.assessment-restore-incomplete';
const LOCK = '.assessment-store.lock';
const COLLECTIONS = ['checks', 'attempts'] as const;
type Collection = typeof COLLECTIONS[number];

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
function payload(backup: AssessmentBackup) {
  return { formatVersion: backup.formatVersion, createdAt: backup.createdAt, timeZone: backup.timeZone, checks: backup.checks, attempts: backup.attempts };
}

// Bound nesting before JSON.parse, ignoring delimiters inside JSON strings.
function assertDepth(text: string): void {
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '[' || character === '{') {
      if (++depth > 32) fail('LIMIT_EXCEEDED', 'Assessment backup nesting exceeds 32');
    } else if (character === ']' || character === '}') depth--;
  }
}

function envelope<T extends VersionedRecord>(value: unknown, parse: (record: unknown) => T): Envelope<T> {
  if (!plainObject(value)) fail('CORRUPT_DATA', 'Malformed backup envelope');
  if (value.formatVersion !== 1) fail('UNSUPPORTED_FORMAT', 'Unsupported backup envelope format');
  exactKeys(value, ['formatVersion', 'record', 'receipts'], 'CORRUPT_DATA');
  if (!plainObject(value.record)) fail('CORRUPT_DATA', 'Malformed backup record');
  assertId(value.record.id, 'CORRUPT_DATA', true);
  validateRecord(value.record, value.record.id, 'CORRUPT_DATA');
  if (!Array.isArray(value.receipts)) fail('CORRUPT_DATA', 'Malformed backup receipts');
  if (value.receipts.length > MAX_RECEIPTS) fail('LIMIT_EXCEEDED', 'Backup receipt capacity exceeded');
  const seen = new Set<string>();
  for (const receipt of value.receipts) {
    if (!plainObject(receipt)) fail('CORRUPT_DATA', 'Malformed backup receipt');
    exactKeys(receipt, ['operationId', 'requestHash'], 'CORRUPT_DATA');
    assertId(receipt.operationId, 'CORRUPT_DATA'); assertHash(receipt.requestHash, 'CORRUPT_DATA');
    if (seen.has(receipt.operationId)) fail('CORRUPT_DATA', 'Duplicate backup receipt');
    seen.add(receipt.operationId);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_FILE_BYTES) fail('LIMIT_EXCEEDED', 'Restored envelope exceeds file byte limit');
  // Existing file-level JSON constraints apply to the complete envelope too.
  assertJson(value, 'CORRUPT_DATA');
  return { formatVersion: 1, record: parse(value.record), receipts: value.receipts as Envelope<T>['receipts'] };
}

function content(revision: CheckRevision) {
  const { reviewed: _reviewed, activatedAt: _activatedAt, ...evaluable } = revision;
  return evaluable;
}
function notFuture(value: string | null, at: string): void {
  if (value !== null && value > at) fail('CORRUPT_DATA', 'Record timestamp is later than backup creation');
}
function revisionTimes(revision: CheckRevision, at: string): void {
  notFuture(revision.createdAt, at); notFuture(revision.activatedAt, at);
}

function validateBackup(value: unknown): AssessmentBackup {
  assertJson(value, 'CORRUPT_DATA');
  if (!plainObject(value)) fail('CORRUPT_DATA', 'Backup must be an object');
  if (value.formatVersion !== 1) fail('UNSUPPORTED_FORMAT', 'Unsupported assessment backup format');
  exactKeys(value, ['formatVersion', 'createdAt', 'timeZone', 'checks', 'attempts', 'checksum'], 'CORRUPT_DATA');
  const createdAt = validateInstant(value.createdAt, 'backup.createdAt');
  if (value.timeZone !== 'Europe/Madrid') fail('CORRUPT_DATA', 'Backup timezone must be Europe/Madrid');
  if (!Array.isArray(value.checks) || !Array.isArray(value.attempts)) fail('CORRUPT_DATA', 'Backup collections must be arrays');
  let count = value.checks.length + value.attempts.length;
  // Count raw arrays before allocating parsed schema copies, then validate shape.
  for (const item of [...value.checks, ...value.attempts]) {
    if (plainObject(item) && plainObject(item.record)) {
      if (Array.isArray(item.record.revisions)) count += item.record.revisions.length;
      if (Array.isArray(item.record.grades)) count += item.record.grades.length;
    }
    if (count > MAX_RECORDS) fail('LIMIT_EXCEEDED', 'Backup exceeds 50000 aggregate/revision/grade records');
  }
  if (count > MAX_RECORDS) fail('LIMIT_EXCEEDED', 'Backup exceeds 50000 aggregate/revision/grade records');
  const checks = value.checks.map(item => envelope(item, parseCheck));
  const attempts = value.attempts.map(item => envelope(item, parseAttempt));
  for (const collection of [checks, attempts]) {
    const ids = new Set<string>();
    for (const item of collection) {
      const id = item.record.id.toLowerCase();
      if (ids.has(id)) fail('CORRUPT_DATA', 'Duplicate or case-colliding backup identity');
      ids.add(id);
    }
  }
  const checkById = new Map(checks.map(item => [item.record.id, item.record]));
  for (const { record } of checks) {
    notFuture(record.createdAt, createdAt); notFuture(record.updatedAt, createdAt); notFuture(record.lastExposedAt, createdAt);
    for (const revision of record.revisions) revisionTimes(revision, createdAt);
  }
  for (const { record } of attempts) {
    notFuture(record.openedAt, createdAt); notFuture(record.frozenAt, createdAt); notFuture(record.lastExposedAt, createdAt);
    revisionTimes(record.snapshot, createdAt);
    for (const grade of record.grades) notFuture(grade.gradedAt, createdAt);
    const source = checkById.get(record.checkId)?.revisions.find(revision => revision.revision === record.checkRevision);
    if (!source || source.reviewPolicyVersion !== record.reviewPolicyVersion || canonical(content(source)) !== canonical(content(record.snapshot))) {
      fail('CORRUPT_DATA', 'Attempt snapshot does not match included check content/policy');
    }
    if (record.snapshot.reviewed) {
      if (!source.reviewed || source.activatedAt !== record.snapshot.activatedAt) fail('CORRUPT_DATA', 'Reviewed snapshot activation differs from source');
    } else if (source.reviewed && (source.activatedAt === null || record.openedAt > source.activatedAt)) {
      fail('CORRUPT_DATA', 'Draft snapshot must precede source activation');
    }
  }
  if (typeof value.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(value.checksum)) fail('CORRUPT_DATA', 'Invalid backup checksum');
  const backup: AssessmentBackup = { formatVersion: 1, createdAt, timeZone: 'Europe/Madrid', checks, attempts, checksum: value.checksum };
  if (digest(payload(backup)) !== value.checksum) fail('CORRUPT_DATA', 'Assessment backup checksum mismatch');
  const text = JSON.stringify(backup);
  if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) fail('LIMIT_EXCEEDED', 'Assessment backup exceeds 50 MiB');
  assertDepth(text);
  return backup;
}

function parseSerialized(input: string | Uint8Array): AssessmentBackup {
  let text: string;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_BACKUP_BYTES) fail('LIMIT_EXCEEDED', 'Assessment backup exceeds 50 MiB');
    text = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_BACKUP_BYTES) fail('LIMIT_EXCEEDED', 'Assessment backup exceeds 50 MiB');
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { fail('CORRUPT_DATA', 'Assessment backup is not valid UTF-8'); }
  } else fail('INVALID_INPUT', 'Restore requires serialized JSON text or UTF-8 bytes');
  assertDepth(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('CORRUPT_DATA', 'Malformed assessment backup JSON'); }
  return validateBackup(parsed);
}

export function serializeAssessmentBackup(backup: AssessmentBackup): string {
  return JSON.stringify(validateBackup(backup));
}

export function assessmentBackupMarkdown(backup: AssessmentBackup): string {
  const text = serializeAssessmentBackup(backup);
  let longest = 3;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = '`'.repeat(longest + 1);
  return `# Assessment backup\n\nReferences and answers are included. Keep this offline export private.\n\n${fence}json\n${text}\n${fence}\n`;
}

async function rejectMarker(root: string): Promise<void> {
  try { await fs.lstat(path.join(root, MARKER)); }
  catch (error) { if (isMissing(error)) return; throw error; }
  fail('INVALID_TRANSITION', 'Assessment restore is incomplete; explicit offline inspection is required');
}

async function loadCollections(root: string, lease: WriterLease) {
  const identities = {} as Record<Collection, Stats>;
  const loaded: { checks: Envelope<CheckRecord>[]; attempts: Envelope<AttemptAggregate>[] } = { checks: [], attempts: [] };
  let bytes = 0; let count = 0;
  for (const collection of COLLECTIONS) {
    const directory = path.join(root, collection);
    await lease.assertOwned(); identities[collection] = await safeDirectory(directory);
    await syncDirectory(directory);
    await assertDirectoryIdentity(directory, identities[collection]);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) fail('CORRUPT_DATA', 'Unexpected entry in assessment collection');
      const id = entry.name.slice(0, -5); assertId(id, 'CORRUPT_DATA', true);
      await lease.assertOwned(); await assertDirectoryIdentity(directory, identities[collection]);
      const item = await readEnvelope(path.join(directory, entry.name), id);
      if (!item) fail('CORRUPT_DATA', 'Assessment record disappeared');
      bytes += Buffer.byteLength(JSON.stringify(item), 'utf8');
      const record = item.record as VersionedRecord & { revisions?: unknown[]; grades?: unknown[] };
      count += 1 + (Array.isArray(record.revisions) ? record.revisions.length : 0) + (Array.isArray(record.grades) ? record.grades.length : 0);
      if (bytes > MAX_BACKUP_BYTES || count > MAX_RECORDS) fail('LIMIT_EXCEEDED', 'Assessment source exceeds backup limits');
      if (collection === 'checks') loaded.checks.push(item as Envelope<CheckRecord>);
      else loaded.attempts.push(item as Envelope<AttemptAggregate>);
    }
    await assertDirectoryIdentity(directory, identities[collection]); await lease.assertOwned();
  }
  return { ...loaded, identities };
}
function makeBackup(createdAt: string, collections: { checks: Envelope<CheckRecord>[]; attempts: Envelope<AttemptAggregate>[] }): AssessmentBackup {
  const data = { formatVersion: 1 as const, createdAt, timeZone: 'Europe/Madrid' as const, checks: collections.checks, attempts: collections.attempts };
  return validateBackup({ ...data, checksum: digest(data) });
}

export async function exportAssessment(input: string, options: AssessmentExportOptions): Promise<AssessmentBackup> {
  if (!plainObject(options)) fail('INVALID_INPUT', 'Export requires clock and ID providers');
  exactKeys(options, ['now', 'id'], 'INVALID_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (!('value' in descriptors.now) || !('value' in descriptors.id) || typeof options.now !== 'function' || typeof options.id !== 'function') fail('INVALID_INPUT', 'Export requires clock and ID providers');
  const at = validateInstant(options.now(), 'backup.now'); const root = absoluteRoot(input);
  const rootIdentity = await safeDirectory(root); await rejectMarker(root);
  const lease = await acquireWriter(root, rootIdentity);
  try {
    await rejectMarker(root);
    const current = await loadCollections(root, lease);
    const source = makeBackup(at, current);
    if (source.attempts.some(item => item.record.status === 'open')) fail('INVALID_TRANSITION', 'Freeze or abandon all open attempts before export');
    const exposureIds = new Set<string>();
    const checks = source.checks.map(item => {
      const operationId = options.id(); assertId(operationId);
      if (exposureIds.has(operationId) || item.receipts.some(receipt => receipt.operationId === operationId)) fail('CONFLICT', 'Exposure operation ID is not fresh');
      exposureIds.add(operationId);
      if (item.receipts.length >= MAX_RECEIPTS || item.record.revision === Number.MAX_SAFE_INTEGER) fail('LIMIT_EXCEEDED', 'Check revision or receipt capacity exhausted');
      const record = parseCheck({ ...item.record, revision: item.record.revision + 1, updatedAt: at, lastExposedAt: at });
      return { formatVersion: 1 as const, record, receipts: [...item.receipts, { operationId, requestHash: digest({ method: 'offlineBackupExposure', id: record.id, previousRevision: item.record.revision, at }) }] };
    });
    // Validate ALL prospective records and the complete result before the first exposure write.
    const prospective = makeBackup(at, { checks, attempts: source.attempts });
    for (const item of prospective.checks) {
      const guard = async () => { await lease.assertOwned(); await assertDirectoryIdentity(path.join(root, 'checks'), current.identities.checks); };
      await writeAtomic(path.join(root, 'checks', `${item.record.id}.json`), JSON.stringify(item), guard);
    }
    const reread = makeBackup(at, await loadCollections(root, lease));
    if (canonical(reread) !== canonical(prospective)) fail('CORRUPT_DATA', 'Export readback differs from persisted exposure');
    return reread;
  } finally { await lease.release(); }
}

async function emptyDirectory(root: string, ownedLock = false): Promise<void> {
  const entries = await fs.readdir(root);
  if (entries.some(name => !ownedLock || name !== LOCK)) fail('INVALID_INPUT', 'Restore target must be an existing empty directory');
}

export async function restoreAssessment(serializedBackup: string | Uint8Array, input: string): Promise<RestoreReport> {
  // No target writes, including lease creation, until the complete input is valid.
  const backup = parseSerialized(serializedBackup); const root = absoluteRoot(input);
  const rootIdentity = await safeDirectory(root); await emptyDirectory(root);
  const lease = await acquireWriter(root, rootIdentity);
  const marker = path.join(root, MARKER); const markerToken = randomUUID();
  let markerIdentity: Stats | undefined; let markerRemoved = false;
  const guard = async () => { await lease.assertOwned(); await assertDirectoryIdentity(root, rootIdentity); };
  async function createMarker(): Promise<void> {
    await guard();
    const handle = await fs.open(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { markerIdentity = await handle.stat(); await handle.writeFile(markerToken, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await guard(); await syncDirectory(root);
  }
  try {
    await guard(); await emptyDirectory(root, true); await createMarker();
    const identities = {} as Record<Collection, Stats>;
    for (const collection of COLLECTIONS) {
      await guard(); identities[collection] = await safeDirectory(path.join(root, collection), true);
      for (const item of backup[collection]) {
        const directory = path.join(root, collection); const file = path.join(directory, `${item.record.id}.json`);
        const recordGuard = async () => { await guard(); await assertDirectoryIdentity(directory, identities[collection]); };
        await recordGuard();
        // The target was empty under our lease. Never replace a newly introduced entry.
        try { await fs.lstat(file); fail('CONFLICT', 'Restore record already exists'); }
        catch (error) { if (!isMissing(error)) throw error; }
        await writeAtomic(file, JSON.stringify(item), recordGuard);
      }
    }
    const loaded = await loadCollections(root, lease);
    // JSON array order is checksum-significant, while directory enumeration order
    // is not: compare each exact envelope in its original backup position.
    if (loaded.checks.length !== backup.checks.length || loaded.attempts.length !== backup.attempts.length) fail('CORRUPT_DATA', 'Restored collection count changed');
    const checksById = new Map(loaded.checks.map(item => [item.record.id, item]));
    const attemptsById = new Map(loaded.attempts.map(item => [item.record.id, item]));
    const ordered = {
      checks: backup.checks.map(item => { const found = checksById.get(item.record.id); if (!found) fail('CORRUPT_DATA', 'Restored check disappeared'); return found; }),
      attempts: backup.attempts.map(item => { const found = attemptsById.get(item.record.id); if (!found) fail('CORRUPT_DATA', 'Restored attempt disappeared'); return found; }),
    };
    const reread = makeBackup(backup.createdAt, ordered);
    if (canonical(reread) !== canonical(backup)) fail('CORRUPT_DATA', 'Restore readback differs from the complete backup');
    await guard();
    const markerNow = await fs.lstat(marker);
    if (!markerIdentity || !sameFile(markerNow, markerIdentity) || await readBounded(marker, 1024) !== markerToken) fail('CONFLICT', 'Restore marker ownership changed');
    await unlinkOwned(marker, markerIdentity); markerRemoved = true;
    try { await guard(); await syncDirectory(root); }
    catch (error) {
      // Keep normal open fail-closed when completion cannot be acknowledged.
      try { await createMarker(); markerRemoved = false; } catch { /* preserve the original persistence failure */ }
      throw error;
    }
    return { root, checks: backup.checks.length, attempts: backup.attempts.length, checksum: backup.checksum };
  } catch (error) {
    if (markerRemoved) { try { await createMarker(); } catch { /* never remove any other writer's file */ } }
    throw error;
  } finally { await lease.release(); }
}
