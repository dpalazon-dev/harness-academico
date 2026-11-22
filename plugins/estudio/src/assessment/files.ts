import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

export type StoreErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'INVALID_TRANSITION' |
  'CONFLICT' | 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'STORE_LOCKED' | 'CORRUPT_DATA';

export class AssessmentStoreError extends Error {
  code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'AssessmentStoreError';
    this.code = code;
  }
}

export class UncertainDurabilityError extends AssessmentStoreError {
  constructor(cause: unknown) {
    super('INVALID_TRANSITION', `Record renamed but directory persistence was not confirmed; close and reopen before retrying: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.cause = cause;
  }
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_RECEIPTS = 10000;
export type VersionedRecord = { id: string; formatVersion: 1; revision: number };
export type Receipt = { operationId: string; requestHash: string };
export type Envelope<T extends VersionedRecord = VersionedRecord> = {
  formatVersion: 1;
  record: T;
  receipts: Receipt[];
};

export function fail(code: StoreErrorCode, message: string): never {
  throw new AssessmentStoreError(code, message);
}

export function isMissing(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ENOENT';
}

export function assertId(value: unknown, code: StoreErrorCode = 'INVALID_INPUT', fileName = false): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value) ||
      (fileName && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))) {
    fail(code, 'Invalid assessment identifier');
  }
}

export function assertHash(value: unknown, code: StoreErrorCode = 'INVALID_INPUT'): asserts value is string {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(value)) {
    fail(code, 'requestHash must be 1 to 256 printable ASCII characters');
  }
}

export function sameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

export function absoluteRoot(input: string): string {
  if (typeof input !== 'string' || input.includes('\0') || !path.isAbsolute(input) ||
      input.startsWith('\\\\') || input.split(/[\\/]/).some(part => part === '..' || part === '.')) {
    fail('INVALID_INPUT', 'Store root must be an absolute local path without traversal');
  }
  const root = path.resolve(input);
  if (root === path.parse(root).root) fail('INVALID_INPUT', 'Filesystem root cannot be the assessment store');
  return root;
}

// Every ancestor is checked, including existing ancestors. Built-in Node path APIs do
// not provide openat/dirfd-relative traversal: a hostile same-user process racing path
// replacement is outside this cooperative, private-directory store's containment.
export async function safeDirectory(directory: string, create = false): Promise<Stats> {
  const parsed = path.parse(directory);
  let current = parsed.root;
  const parts = directory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let result = await fs.lstat(current);
  if (result.isSymbolicLink() || !result.isDirectory()) fail('INVALID_INPUT', 'Unsafe filesystem root');
  for (const part of parts) {
    current = path.join(current, part);
    try {
      result = await fs.lstat(current);
    } catch (error) {
      if (!create || !isMissing(error)) throw error;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as { code?: string }).code !== 'EEXIST') throw mkdirError;
      }
      result = await fs.lstat(current);
      if (result.isSymbolicLink() || !result.isDirectory()) fail('INVALID_INPUT', 'Unsafe store directory');
      await syncDirectory(path.dirname(current));
    }
    if (result.isSymbolicLink() || !result.isDirectory()) fail('INVALID_INPUT', 'Symlink or non-directory in store path');
  }
  return result;
}

export async function assertDirectoryIdentity(directory: string, expected: Stats): Promise<void> {
  if (!sameFile(await safeDirectory(directory), expected)) fail('INVALID_INPUT', 'Store directory identity changed');
}

// Fails closed where directories cannot be opened and fsynced, except on Windows:
// NTFS cannot open a directory for fsync at all, and its rename already commits the
// directory entry through the filesystem journal, so the step is skipped there.
const WINDOWS_DIRECTORY_SYNC_CODES = ['EISDIR', 'EPERM', 'EACCES'];

export async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    await handle.sync();
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (process.platform === 'win32' && WINDOWS_DIRECTORY_SYNC_CODES.includes(code)) return;
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR', 'EPERM'].includes(code)) {
      fail('INVALID_TRANSITION', 'Durable directory synchronization is unsupported or denied on this filesystem; platform acceptance is pending');
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function regularFileStat(file: string): Promise<Stats | null> {
  let info: Stats;
  try { info = await fs.lstat(file); } catch (error) { if (isMissing(error)) return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) fail('INVALID_INPUT', 'Record must be a regular file with one link');
  return info;
}

export async function readBounded(file: string, maxBytes = MAX_FILE_BYTES): Promise<string | null> {
  const before = await regularFileStat(file);
  if (!before) return null;
  if (before.size > maxBytes) fail('LIMIT_EXCEEDED', 'Assessment file exceeds byte limit');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) fail('INVALID_INPUT', 'Record identity changed while opening');
    if (opened.size > maxBytes) fail('LIMIT_EXCEEDED', 'Assessment file exceeds byte limit');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > maxBytes) fail('LIMIT_EXCEEDED', 'Assessment file exceeds byte limit');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { fail('CORRUPT_DATA', 'Assessment file is not valid UTF-8'); }
  } finally { await handle.close(); }
}

export function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function exactKeys(value: Record<string, unknown>, expected: string[], code: StoreErrorCode): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) fail(code, 'Unexpected or missing store fields');
}

// Validate before stringify so undefined, accessors, nonfinite numbers, custom
// toJSON, sparse arrays and cycles cannot silently change the committed payload.
export function assertJson(value: unknown, code: StoreErrorCode): void {
  const active = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (depth > 100) fail(code, 'JSON nesting exceeds safe limit of 100');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || item === null) fail(code, 'Record must contain only finite JSON values');
    if (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !plainObject(item)) {
      fail(code, 'Only plain JSON objects and arrays with the ordinary array prototype are supported');
    }
    if (active.has(item)) fail(code, 'Cyclic record');
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length !== 0) fail(code, 'Symbol keys are unsupported');
    if (Array.isArray(item)) {
      const names = Object.keys(descriptors).filter(key => key !== 'length');
      if (names.length !== item.length) fail(code, 'Sparse or decorated arrays are unsupported');
      for (let index = 0; index < item.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code, 'Array accessors are unsupported');
        visit(descriptor.value, depth + 1);
      }
    } else {
      for (const descriptor of Object.values(descriptors)) {
        if (!('value' in descriptor) || !descriptor.enumerable) fail(code, 'Non-enumerable properties or accessors are unsupported');
        visit(descriptor.value, depth + 1);
      }
    }
    active.delete(item);
  }
  visit(value, 0);
}

export function validateRecord(value: unknown, id: string, code: StoreErrorCode): asserts value is VersionedRecord {
  if (!plainObject(value)) fail(code, 'Record must be an object');
  if (value.formatVersion !== 1) {
    if ('formatVersion' in value) fail('UNSUPPORTED_FORMAT', 'Unsupported assessment record format');
    fail(code, 'Missing record format');
  }
  assertId(value.id, code, true);
  if (value.id !== id || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) fail(code, 'Invalid record identity or revision');
}

export async function readEnvelope<T extends VersionedRecord>(file: string, id: string): Promise<Envelope<T> | null> {
  const text = await readBounded(file);
  if (text === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('CORRUPT_DATA', 'Malformed assessment JSON'); }
  if (!plainObject(parsed)) fail('CORRUPT_DATA', 'Malformed assessment envelope');
  if (parsed.formatVersion !== 1) {
    if ('formatVersion' in parsed) fail('UNSUPPORTED_FORMAT', 'Unsupported assessment envelope format');
    fail('CORRUPT_DATA', 'Missing envelope format');
  }
  exactKeys(parsed, ['formatVersion', 'record', 'receipts'], 'CORRUPT_DATA');
  assertJson(parsed, 'CORRUPT_DATA');
  validateRecord(parsed.record, id, 'CORRUPT_DATA');
  if (!Array.isArray(parsed.receipts)) fail('CORRUPT_DATA', 'Malformed operation receipts');
  if (parsed.receipts.length > MAX_RECEIPTS) fail('LIMIT_EXCEEDED', 'Operation receipt capacity exceeded');
  const seen = new Set<string>();
  for (const receipt of parsed.receipts) {
    if (!plainObject(receipt)) fail('CORRUPT_DATA', 'Malformed operation receipt');
    exactKeys(receipt, ['operationId', 'requestHash'], 'CORRUPT_DATA');
    assertId(receipt.operationId, 'CORRUPT_DATA');
    assertHash(receipt.requestHash, 'CORRUPT_DATA');
    if (seen.has(receipt.operationId)) fail('CORRUPT_DATA', 'Duplicate operation receipt');
    seen.add(receipt.operationId);
  }
  return parsed as Envelope<T>;
}

export async function unlinkOwned(file: string, identity: Stats): Promise<void> {
  let current: Stats;
  try { current = await fs.lstat(file); } catch (error) { if (isMissing(error)) return; throw error; }
  if (current.isSymbolicLink() || !current.isFile() || !sameFile(current, identity)) fail('INVALID_INPUT', 'Refusing to remove a file no longer owned by this writer');
  await fs.unlink(file);
}

export async function writeAtomic(file: string, text: string, guard: () => Promise<void>): Promise<void> {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) fail('LIMIT_EXCEEDED', 'Assessment file exceeds byte limit');
  await guard();
  await regularFileStat(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let identity: Stats | undefined;
  let renamed = false;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    identity = await handle.stat();
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await guard();
    await regularFileStat(file);
    await fs.rename(temporary, file);
    renamed = true;
    try {
      await guard();
      await syncDirectory(path.dirname(file));
    } catch (error) { throw new UncertainDurabilityError(error); }
  } finally {
    await handle?.close();
    if (!renamed && identity) {
      await guard();
      await unlinkOwned(temporary, identity);
    }
  }
}
