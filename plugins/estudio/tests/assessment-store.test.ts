import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { openAssessmentStore as openStore, type AssessmentFileStore } from '../src/assessment/store.ts';

type Row = { id: string; formatVersion: 1; revision: number; value: string };
const fixtureStores = new Map<string, AssessmentFileStore[]>();
async function openAssessmentStore(root: string) {
  const store = await openStore(root);
  fixtureStores.get(root)?.push(store);
  return store;
}
const options = (operationId: string, expectedRevision: number | null, requestHash = operationId) =>
  ({ operationId, expectedRevision, requestHash });
const create = (id = 'item', value = 'first'): Row => ({ id, formatVersion: 1, revision: 1, value });
const code = (expected: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, expected);
  return true;
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'assessment-store-'));
  const root = path.join(parent, 'data');
  const stores: AssessmentFileStore[] = [];
  fixtureStores.set(root, stores);
  t.after(async () => {
    try { for (const store of stores) await store.close(); }
    finally { fixtureStores.delete(root); await fs.rm(parent, { recursive: true, force: true }); }
  });
  return { parent, root };
}

test('acknowledged create and update survive close/reopen with detached read copies', async t => {
  const { root } = await fixture(t);
  let store = await openAssessmentStore(root);
  const row = await store.commit<Row>('checks', 'item', options('create', null), () => create());
  row.value = 'outside mutation';
  assert.equal((await store.read<Row>('checks', 'item'))?.value, 'first');
  const updated = await store.commit<Row>('checks', 'item', options('update', 1), current =>
    ({ ...current!, revision: 2, value: 'second' }));
  assert.equal(updated.revision, 2);
  await store.close();
  store = await openAssessmentStore(root);
  t.after(() => store.close());
  assert.deepEqual(await store.read('checks', 'item'), { ...create(), revision: 2, value: 'second' });
  assert.deepEqual(await store.list('checks'), [{ ...create(), revision: 2, value: 'second' }]);
  assert.equal(await store.read('attempts', 'missing'), null);
});

test('same operation is applied once and retries read the latest record after reopen', async t => {
  const { root } = await fixture(t);
  let store = await openAssessmentStore(root);
  let calls = 0;
  await store.commit<Row>('checks', 'item', options('create', null), () => { calls++; return create(); });
  await store.commit<Row>('checks', 'item', options('update', 1), row => ({ ...row!, revision: 2, value: 'second' }));
  await store.close();
  store = await openAssessmentStore(root);
  t.after(() => store.close());
  const replay = await store.commit<Row>('checks', 'item', options('create', null), () => { calls++; return create(); });
  assert.equal(calls, 1);
  assert.equal(replay.revision, 2);
  assert.equal(replay.value, 'second');
  await assert.rejects(store.commit('checks', 'item', options('create', null, 'changed'), () => create()), code('CONFLICT'));
});

test('stale revisions, wrong assigned revision and wrong identity leave the record unchanged', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  await store.commit('checks', 'item', options('create', null), () => create());
  let transformed = false;
  await assert.rejects(store.commit('checks', 'item', options('stale', null), () => { transformed = true; return create(); }), code('CONFLICT'));
  assert.equal(transformed, false);
  await assert.rejects(store.commit('checks', 'item', options('wrongrev', 1), () => create()), code('INVALID_INPUT'));
  await assert.rejects(store.commit('checks', 'item', options('wrongid', 1), () => ({ ...create('other'), revision: 2 })), code('INVALID_INPUT'));
  assert.deepEqual(await store.read('checks', 'item'), create());
});

test('concurrent retries and conflicting updates serialize without duplicate transforms', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    store.commit('checks', 'item', options('create', null), () => { calls++; return create(); })));
  assert.equal(calls, 1);
  assert.equal(results.length, 12);
  const updates = await Promise.allSettled(['one', 'two'].map(operationId =>
    store.commit<Row>('checks', 'item', options(operationId, 1), row => ({ ...row!, revision: 2, value: operationId }))));
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = updates.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'CONFLICT');
});

test('second writer is rejected and close releases only its owned lock', async t => {
  const { root } = await fixture(t);
  const first = await openAssessmentStore(root);
  await assert.rejects(openAssessmentStore(root), code('STORE_LOCKED'));
  await first.close();
  await first.close();
  const second = await openAssessmentStore(root);
  t.after(() => second.close());
  await first.close();
  await assert.rejects(openAssessmentStore(root), code('STORE_LOCKED'));
});

test('a lock left by a process that has exited is removed on open', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(root);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const deadPid = Number(child.stdout);
  await fs.writeFile(path.join(root, '.assessment-store.lock'), `${deadPid}:${'a'.repeat(64)}`);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  assert.match(await fs.readFile(path.join(root, '.assessment-store.lock'), 'utf8'), new RegExp(`^${process.pid}:[0-9a-f]{64}$`));
});

test('a lock held by a running process is never stolen', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(root);
  const live = `${process.ppid}:${'b'.repeat(64)}`;
  await fs.writeFile(path.join(root, '.assessment-store.lock'), live);
  await assert.rejects(openAssessmentStore(root), code('STORE_LOCKED'));
  assert.equal(await fs.readFile(path.join(root, '.assessment-store.lock'), 'utf8'), live);
});

test('a leftover lock that names no owner is never automatically stolen', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, '.assessment-store.lock'), 'unverifiable-old-owner');
  await assert.rejects(openAssessmentStore(root), code('STORE_LOCKED'));
  assert.equal(await fs.readFile(path.join(root, '.assessment-store.lock'), 'utf8'), 'unverifiable-old-owner');
});

test('unknown envelope formats and malformed JSON fail visibly instead of returning empty data', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  await fs.writeFile(path.join(root, 'checks', 'future.json'), JSON.stringify({ formatVersion: 2, record: create('future'), receipts: [] }));
  await assert.rejects(store.read('checks', 'future'), code('UNSUPPORTED_FORMAT'));
  await fs.writeFile(path.join(root, 'checks', 'broken.json'), '{broken');
  await assert.rejects(store.read('checks', 'broken'), code('CORRUPT_DATA'));
  await assert.rejects(store.list('checks'), error => ['CORRUPT_DATA', 'UNSUPPORTED_FORMAT'].includes((error as { code: string }).code));
});

test('invalid record format, mismatched file identity and duplicate receipts are corruption', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  const file = path.join(root, 'checks', 'item.json');
  await fs.writeFile(file, JSON.stringify({ formatVersion: 1, record: { ...create(), formatVersion: 2 }, receipts: [] }));
  await assert.rejects(store.read('checks', 'item'), code('UNSUPPORTED_FORMAT'));
  await fs.writeFile(file, JSON.stringify({ formatVersion: 1, record: create('other'), receipts: [] }));
  await assert.rejects(store.read('checks', 'item'), code('CORRUPT_DATA'));
  await fs.writeFile(file, JSON.stringify({ formatVersion: 1, record: create(), receipts: [
    { operationId: 'same', requestHash: 'hash' }, { operationId: 'same', requestHash: 'hash' },
  ] }));
  await assert.rejects(store.read('checks', 'item'), code('CORRUPT_DATA'));
});

test('oversized files are rejected before JSON parsing and oversized writes preserve the previous record', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  await fs.writeFile(path.join(root, 'checks', 'huge.json'), 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(store.read('checks', 'huge'), code('LIMIT_EXCEEDED'));
  await store.commit('checks', 'item', options('create', null), () => create());
  await assert.rejects(store.commit<Row>('checks', 'item', options('oversize', 1), row => ({ ...row!, revision: 2, value: 'x'.repeat(8 * 1024 * 1024) })), code('LIMIT_EXCEEDED'));
  assert.deepEqual(await store.read('checks', 'item'), create());
});

test('receipt capacity is explicit and existing receipts remain replayable', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  const receipts = Array.from({ length: 10000 }, (_, index) => ({ operationId: `op_${index}`, requestHash: `hash_${index}` }));
  await fs.writeFile(path.join(root, 'checks', 'item.json'), JSON.stringify({ formatVersion: 1, record: create(), receipts }));
  assert.deepEqual(await store.commit('checks', 'item', options('op_0', null, 'hash_0'), () => { throw new Error('must not run'); }), create());
  await assert.rejects(store.commit('checks', 'item', options('extra', 1), () => ({ ...create(), revision: 2 })), code('LIMIT_EXCEEDED'));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'checks', 'item.json'), 'utf8')).receipts.length, 10000);
});

test('unsafe roots, IDs and collection names are rejected before filesystem access', async t => {
  const { root } = await fixture(t);
  await assert.rejects(openAssessmentStore('relative/path'), code('INVALID_INPUT'));
  await assert.rejects(openAssessmentStore(path.join(root, 'child') + '/../../escape'), code('INVALID_INPUT'));
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  for (const id of ['../escape', '', 'a/b', 'a\\b', 'x'.repeat(81), 'CON', 'nul', 'LPT1']) {
    await assert.rejects(store.read('checks', id), code('INVALID_INPUT'));
  }
  await assert.rejects(store.read('other' as 'checks', 'item'), code('INVALID_INPUT'));
  await assert.rejects(store.commit('checks', 'item', options('../escape', null), () => create()), code('INVALID_INPUT'));
});

test('root, collection and record symlinks cannot redirect store IO', async t => {
  const { parent, root } = await fixture(t);
  const outside = path.join(parent, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, root, 'dir');
  await assert.rejects(openAssessmentStore(root), code('INVALID_INPUT'));
  await fs.unlink(root);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  await fs.writeFile(path.join(outside, 'secret'), JSON.stringify({ formatVersion: 1, record: create(), receipts: [] }));
  await fs.symlink(path.join(outside, 'secret'), path.join(root, 'checks', 'item.json'));
  await assert.rejects(store.read('checks', 'item'), code('INVALID_INPUT'));
  await assert.rejects(store.commit('checks', 'item', options('replace', null), () => create()), code('INVALID_INPUT'));
  await fs.unlink(path.join(root, 'checks', 'item.json'));
  await fs.rmdir(path.join(root, 'attempts'));
  await fs.symlink(outside, path.join(root, 'attempts'), 'dir');
  await assert.rejects(store.list('attempts'), code('INVALID_INPUT'));
  assert.deepEqual(await fs.readdir(outside), ['secret']);
});

test('failure before rename preserves prior record and receipt, and cleans only owned temporary files', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  await store.commit('checks', 'item', options('create', null), () => create());
  const previousBytes = await fs.readFile(path.join(root, 'checks', 'item.json'), 'utf8');
  const unrelated = path.join(root, 'checks', '.unrelated.tmp');
  await fs.writeFile(unrelated, 'preserve');
  // An I/O fault at the real rename seam models an interruption after temp-file fsync.
  const rename = t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' }); });
  await assert.rejects(store.commit<Row>('checks', 'item', options('failed', 1), row => ({ ...row!, revision: 2, value: 'lost' })), /simulated rename failure/);
  rename.mock.restore();
  assert.equal(await fs.readFile(path.join(root, 'checks', 'item.json'), 'utf8'), previousBytes);
  assert.deepEqual((await fs.readdir(path.join(root, 'checks'))).sort(), ['.unrelated.tmp', 'item.json']);
  const retried = await store.commit<Row>('checks', 'item', options('failed', 1), row => ({ ...row!, revision: 2, value: 'retried' }));
  assert.equal(retried.value, 'retried');
});

test('invalid JSON values cannot be silently changed by serialization', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  t.after(() => store.close());
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, BigInt(1)]) {
    await assert.rejects(store.commit('checks', 'item', options('bad', null), () => ({ ...create(), value })), code('INVALID_INPUT'));
  }
  const cyclic: Record<string, unknown> = { ...create() };
  cyclic.self = cyclic;
  await assert.rejects(store.commit('checks', 'item', options('cycle', null), () => cyclic as Row), code('INVALID_INPUT'));
  assert.equal(await store.read('checks', 'item'), null);
});

test('directory sync failure after rename is not acknowledged and blocks further access until reopen', async t => {
  const { root } = await fixture(t);
  let store = await openAssessmentStore(root);
  await store.commit('checks', 'item', options('create', null), () => create());
  const originalOpen = fs.open.bind(fs);
  const openMock = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === path.join(root, 'checks') && (await handle.stat()).isDirectory()) {
      t.mock.method(handle, 'sync', async () => { throw Object.assign(new Error('simulated directory sync failure'), { code: 'EIO' }); });
    }
    return handle;
  });
  await assert.rejects(store.commit<Row>('checks', 'item', options('ambiguous', 1), row => ({ ...row!, revision: 2, value: 'maybe durable' })), /simulated directory sync failure/);
  openMock.mock.restore();
  await assert.rejects(store.read('checks', 'item'), code('INVALID_TRANSITION'));
  await assert.rejects(store.commit('checks', 'item', options('later', 2), () => ({ ...create(), revision: 3 })), code('INVALID_TRANSITION'));
  await store.close();
  store = await openAssessmentStore(root);
  t.after(() => store.close());
  let called = false;
  const replay = await store.commit<Row>('checks', 'item', options('ambiguous', 1), () => { called = true; return create(); });
  assert.equal(called, false);
  assert.equal(replay.revision, 2);
  assert.equal(replay.value, 'maybe durable');
});

for (const collection of ['checks', 'attempts'] as const) {
  test(`reopen must confirm ${collection} directory persistence before acknowledging an uncertain receipt`, {
    skip: process.platform === 'win32' && 'Windows cannot fsync directories; syncDirectory skips that step there',
  }, async t => {
    const { root } = await fixture(t);
    let store = await openAssessmentStore(root);
    await store.commit(collection, 'item', options('create', null), () => create());
    const originalOpen = fs.open.bind(fs);
    const targetDirectory = path.join(root, collection);
    let allowSync = false;
    const confirmedDirectories: string[] = [];
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if ((args[0] === path.join(root, 'checks') || args[0] === path.join(root, 'attempts')) && (await handle.stat()).isDirectory()) {
        const originalSync = handle.sync.bind(handle);
        t.mock.method(handle, 'sync', async () => {
          if (args[0] === targetDirectory && !allowSync) {
            throw Object.assign(new Error('simulated persistent collection sync failure'), { code: 'EIO' });
          }
          await originalSync();
          confirmedDirectories.push(String(args[0]));
        });
      }
      return handle;
    });
    await assert.rejects(store.commit<Row>(collection, 'item', options('ambiguous', 1), row => ({ ...row!, revision: 2, value: 'pending persistence' })), /simulated persistent collection sync failure/);
    await store.close();
    await assert.rejects(openAssessmentStore(root), /simulated persistent collection sync failure/);
    allowSync = true;
    confirmedDirectories.length = 0;
    store = await openAssessmentStore(root);
    assert.ok(confirmedDirectories.includes(targetDirectory), 'successful reopen must persist the exact collection directory');
    assert.ok(confirmedDirectories.includes(path.join(root, 'checks')));
    assert.ok(confirmedDirectories.includes(path.join(root, 'attempts')));
    let transforms = 0;
    const replay = await store.commit<Row>(collection, 'item', options('ambiguous', 1), () => { transforms++; return create(); });
    assert.equal(transforms, 0);
    assert.equal(replay.revision, 2);
    assert.equal(replay.value, 'pending persistence');
    const envelope = JSON.parse(await fs.readFile(path.join(targetDirectory, 'item.json'), 'utf8'));
    assert.equal(envelope.receipts.filter((receipt: { operationId: string }) => receipt.operationId === 'ambiguous').length, 1);
  });
}

function rowWithLeafAtDepth(depth: number, revision: number) {
  let nested: unknown = 'leaf';
  for (let index = 1; index < depth; index++) nested = { next: nested };
  return { ...create(), revision, nested };
}

test('record nesting that exceeds envelope depth is rejected before consuming a receipt', async t => {
  const { root } = await fixture(t);
  let store = await openAssessmentStore(root);
  await store.commit('checks', 'item', options('create', null), () => create());
  const file = path.join(root, 'checks', 'item.json');
  const previous = await fs.readFile(file, 'utf8');
  await assert.rejects(store.commit('checks', 'item', options('depth', 1), () => rowWithLeafAtDepth(100, 2)), code('INVALID_INPUT'));
  assert.equal(await fs.readFile(file, 'utf8'), previous);
  const accepted = rowWithLeafAtDepth(99, 2);
  assert.deepEqual(await store.commit('checks', 'item', options('depth', 1), () => accepted), accepted);
  assert.deepEqual(await store.read('checks', 'item'), accepted);
  assert.deepEqual(await store.list('checks'), [accepted]);
  await store.close();
  store = await openAssessmentStore(root);
  assert.deepEqual(await store.read('checks', 'item'), accepted);
  assert.deepEqual(await store.list('checks'), [accepted]);
});

test('ordinary arrays preserve values but inherited array serialization cannot change a committed record', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  await store.commit('checks', 'item', options('create', null), () => ({ ...create(), values: ['ordinary'] }));
  const file = path.join(root, 'checks', 'item.json');
  const previous = await fs.readFile(file, 'utf8');
  let serialized = 0;
  const values = ['original'];
  Object.setPrototypeOf(values, Object.assign(Object.create(Array.prototype), {
    toJSON() { serialized++; return undefined; },
  }));
  await assert.rejects(store.commit('checks', 'item', options('array', 1), () => ({ ...create(), revision: 2, values })), code('INVALID_INPUT'));
  assert.equal(serialized, 0, 'inherited toJSON must never execute');
  assert.equal(await fs.readFile(file, 'utf8'), previous);
  assert.deepEqual(await store.read('checks', 'item'), { ...create(), values: ['ordinary'] });
  assert.deepEqual(await store.commit('checks', 'item', options('array', 1), () => ({ ...create(), revision: 2, values: ['safe'] })), { ...create(), revision: 2, values: ['safe'] });
});

test('closed store rejects queued work without creating new records', async t => {
  const { root } = await fixture(t);
  const store = await openAssessmentStore(root);
  await store.close();
  await assert.rejects(store.read('checks', 'item'), code('INVALID_TRANSITION'));
  await assert.rejects(store.commit('checks', 'item', options('late', null), () => create()), code('INVALID_TRANSITION'));
});
