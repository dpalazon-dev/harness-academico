import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_RECEIPTS, UncertainDurabilityError, absoluteRoot, assertDirectoryIdentity,
  assertHash, assertId, assertJson, exactKeys, fail, isMissing, plainObject, readEnvelope,
  safeDirectory, syncDirectory, validateRecord, writeAtomic,
  type Envelope, type VersionedRecord,
} from './files.ts';
import { acquireWriter } from './lock.ts';

export { AssessmentStoreError } from './files.ts';
export type { VersionedRecord } from './files.ts';
export type AssessmentCollection = 'checks' | 'attempts';
export type CommitOptions = { operationId: string; requestHash: string; expectedRevision: number | null };
export interface AssessmentFileStore {
  read<T extends VersionedRecord>(collection: AssessmentCollection, id: string): Promise<T | null>;
  list<T extends VersionedRecord>(collection: AssessmentCollection): Promise<T[]>;
  commit<T extends VersionedRecord>(collection: AssessmentCollection, id: string, options: CommitOptions, transform: (current: T | null) => T): Promise<T>;
  close(): Promise<void>;
}

export async function openAssessmentStore(input: string): Promise<AssessmentFileStore> {
  const root = absoluteRoot(input);
  const rootIdentity = await safeDirectory(root, true);
  async function rejectIncompleteRestore(): Promise<void> {
    try { await fs.lstat(path.join(root, '.assessment-restore-incomplete')); }
    catch (error) { if (isMissing(error)) return; throw error; }
    fail('INVALID_TRANSITION', 'Assessment restore is incomplete; explicit offline inspection is required');
  }
  await rejectIncompleteRestore();
  const lease = await acquireWriter(root, rootIdentity);
  let directories: Record<AssessmentCollection, Awaited<ReturnType<typeof safeDirectory>>>;
  try {
    await rejectIncompleteRestore();
    directories = {
      checks: await safeDirectory(path.join(root, 'checks'), true),
      attempts: await safeDirectory(path.join(root, 'attempts'), true),
    };
    // A previous writer may have observed rename success but failed directory sync.
    // Confirm both existing directories before any receipt replay can acknowledge it.
    for (const collection of ['checks', 'attempts'] as const) {
      const directory = path.join(root, collection);
      await lease.assertOwned();
      await assertDirectoryIdentity(directory, directories[collection]);
      await syncDirectory(directory);
      await assertDirectoryIdentity(directory, directories[collection]);
    }
    await lease.assertOwned();
  } catch (error) { await lease.release(); throw error; }
  let state: 'open' | 'closing' | 'closed' = 'open';
  let poisoned = false;
  let tail: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | undefined;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (state !== 'open') return Promise.reject(Object.assign(new Error('Assessment store is closed'), { code: 'INVALID_TRANSITION' }));
    const result = tail.then(async () => {
      if (poisoned) fail('INVALID_TRANSITION', 'Durability is uncertain; close and reopen before accessing the store');
      await lease.assertOwned();
      try { return await operation(); }
      catch (error) { if (error instanceof UncertainDurabilityError) poisoned = true; throw error; }
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function directory(collection: AssessmentCollection): string {
    if (collection !== 'checks' && collection !== 'attempts') fail('INVALID_INPUT', 'Unknown assessment collection');
    return path.join(root, collection);
  }

  async function guard(collection: AssessmentCollection): Promise<void> {
    await lease.assertOwned();
    await assertDirectoryIdentity(directory(collection), directories[collection]);
  }

  async function load<T extends VersionedRecord>(collection: AssessmentCollection, id: string): Promise<Envelope<T> | null> {
    assertId(id, 'INVALID_INPUT', true);
    await guard(collection);
    return readEnvelope<T>(path.join(directory(collection), `${id}.json`), id);
  }

  return {
    read<T extends VersionedRecord>(collection: AssessmentCollection, id: string) {
      return enqueue(async () => (await load<T>(collection, id))?.record ?? null);
    },
    list<T extends VersionedRecord>(collection: AssessmentCollection) {
      return enqueue(async () => {
        await guard(collection);
        const entries = await fs.readdir(directory(collection), { withFileTypes: true });
        const rows: T[] = [];
        for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name, 'en'))) {
          if (entry.isSymbolicLink()) fail('INVALID_INPUT', 'Symlink in assessment collection');
          if (!entry.name.endsWith('.json')) continue;
          const id = entry.name.slice(0, -5);
          assertId(id, 'CORRUPT_DATA', true);
          const envelope = await load<T>(collection, id);
          if (!envelope) fail('CORRUPT_DATA', 'Record disappeared during list');
          rows.push(envelope.record);
        }
        return rows;
      });
    },
    commit<T extends VersionedRecord>(collection: AssessmentCollection, id: string, options: CommitOptions, transform: (current: T | null) => T) {
      return enqueue(async () => {
        if (!plainObject(options)) fail('INVALID_INPUT', 'Commit options must be an object');
        assertJson(options, 'INVALID_INPUT');
        exactKeys(options, ['operationId', 'requestHash', 'expectedRevision'], 'INVALID_INPUT');
        assertId(options.operationId);
        assertHash(options.requestHash);
        if (options.expectedRevision !== null && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1)) fail('INVALID_INPUT', 'Invalid expected revision');
        if (typeof transform !== 'function') fail('INVALID_INPUT', 'Commit transform must be synchronous function');
        const current = await load<T>(collection, id);
        const receipt = current?.receipts.find(item => item.operationId === options.operationId);
        if (receipt) {
          if (receipt.requestHash !== options.requestHash) fail('CONFLICT', 'Operation ID was used with another request hash');
          return current!.record;
        }
        if ((current?.record.revision ?? null) !== options.expectedRevision) fail('CONFLICT', 'Assessment record revision changed');
        if ((current?.receipts.length ?? 0) >= MAX_RECEIPTS) fail('LIMIT_EXCEEDED', 'Operation receipt capacity reached; no receipt was evicted');
        const revision = (current?.record.revision ?? 0) + 1;
        if (!Number.isSafeInteger(revision)) fail('LIMIT_EXCEEDED', 'Record revision exhausted');
        const record = transform(current?.record ?? null);
        assertJson(record, 'INVALID_INPUT');
        validateRecord(record, id, 'INVALID_INPUT');
        if (record.revision !== revision) fail('INVALID_INPUT', 'Transform must return the next record revision');
        const envelope: Envelope<T> = { formatVersion: 1, record, receipts: [
          ...(current?.receipts ?? []), { operationId: options.operationId, requestHash: options.requestHash },
        ] };
        // Read validates this same complete envelope, including its extra depth.
        assertJson(envelope, 'INVALID_INPUT');
        const serialized = JSON.stringify(envelope);
        await writeAtomic(path.join(directory(collection), `${id}.json`), serialized, () => guard(collection));
        return (JSON.parse(serialized) as Envelope<T>).record;
      });
    },
    close() {
      if (closePromise) return closePromise;
      state = 'closing';
      closePromise = tail.then(async () => {
        try { await lease.release(); } finally { state = 'closed'; }
      });
      return closePromise;
    },
  };
}
