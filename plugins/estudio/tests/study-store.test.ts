import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { StudyError } from '../src/study/types.ts';
import { tempStore, unit, LATER } from './study-fixtures.ts';

const is = (code: string) => (error: unknown) => error instanceof StudyError && error.code === code;

test('a saved unit reads back equal, and the returned copy is detached', t => {
  const store = tempStore(t);
  const saved = store.saveUnit(unit(), null);
  saved.title = 'mutated';
  assert.deepEqual(store.getUnit('u1'), unit());
  assert.equal(store.getUnit('missing'), null);
});

test('saving with a stale or wrong revision is a conflict and changes nothing', t => {
  const store = tempStore(t);
  store.saveUnit(unit(), null);
  assert.throws(() => store.saveUnit(unit(), null), is('CONFLICT'));
  assert.throws(() => store.saveUnit(unit({ revision: 2, title: 'B' }), 2), is('CONFLICT'));
  assert.throws(() => store.saveUnit(unit({ revision: 3 }), 1), is('INVALID_INPUT'));
  store.saveUnit(unit({ revision: 2, title: 'B', updatedAt: LATER }), 1);
  assert.equal(store.getUnit('u1')?.title, 'B');
});

test('listing skips temporary files and a corrupt record does not hide the others', t => {
  const store = tempStore(t);
  store.saveUnit(unit(), null);
  store.saveUnit(unit({ id: 'u2' }), null);
  fs.writeFileSync(path.join(store.root, 'units', '.u3-abc.tmp'), '{');
  fs.writeFileSync(path.join(store.root, 'units', 'u4.json'), '{ not json');
  assert.deepEqual(store.listUnits().map(u => u.id), ['u1', 'u2']);
  assert.throws(() => store.getUnit('u4'), is('CORRUPT_DATA'));
});

test('a failed write leaves the previous record and no temporary file behind', t => {
  const store = tempStore(t);
  store.saveUnit(unit(), null);
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
  assert.throws(() => store.saveUnit(unit({ revision: 2, title: 'B' }), 1), /disk full/);
  t.mock.restoreAll();
  assert.equal(store.getUnit('u1')?.title, unit().title);
  assert.deepEqual(fs.readdirSync(path.join(store.root, 'units')), ['u1.json']);
});
