import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { renderRecord } from '../src/kb/records.ts';
import type { KbEntidad } from '../src/kb/types.ts';
import { fakeKbol, tempKb } from './kb-fixtures.ts';

const entidad = (id: string, nombre: string): KbEntidad => ({
  id, type: 'entidad', clase: 'registro', title: nombre, description: `${nombre}.`, ambito: 'estudio', autor: 'human:david',
  eventos: [], sources: [], estado: 'propuesta', nombre, alias: [], clase_entidad: 'dataset',
});

const gitLog = (dir: string) => childProcess.execFileSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');

test('initialization creates the layout, the owner records and one commit, and is idempotent', async t => {
  fakeKbol(t);
  const repo = await tempKb(t);
  await repo.ensureInitialized();
  const owner = repo.owner();
  assert.match(owner.persona, /^PER-/);
  assert.match(owner.rol, /^ROL-/);
  assert.ok(fs.existsSync(path.join(repo.config.kbDir, 'kb', 'hechos')));
  assert.deepEqual(gitLog(repo.config.kbDir), ['Inicia la base de conocimiento de estudio']);
});

test('a valid batch is validated with KBOL, written and committed', async t => {
  const { calls } = fakeKbol(t);
  const repo = await tempKb(t);
  const before = calls.length;
  const sha = await repo.commit([{ path: 'kb/entidades/ENT-1.md', text: renderRecord(entidad('ENT-1', 'SWaT'), '# SWaT') }], 'Añade SWaT');
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(calls.length - before, 1);
  assert.deepEqual(calls.at(-1)!.slice(0, 5), ['run', '--no-sync', 'kbol', 'validar', '--modo']);
  assert.equal(repo.get('ENT-1')?.header.nombre, 'SWaT');
  assert.equal(gitLog(repo.config.kbDir)[0], 'Añade SWaT');
});

test('a batch with one invalid record writes nothing and makes no commit', async t => {
  fakeKbol(t);
  const repo = await tempKb(t);
  await assert.rejects(repo.commit([
    { path: 'kb/entidades/ENT-1.md', text: renderRecord(entidad('ENT-1', 'SWaT'), '# SWaT') },
    { path: 'kb/entidades/ENT-2.md', text: renderRecord(entidad('ENT-2', 'WADI'), '# INVALIDO') },
  ], 'Lote'), /KBOL rechaza el lote.*ENT-2.*campo desconocido/s);
  assert.equal(fs.existsSync(path.join(repo.config.kbDir, 'kb/entidades/ENT-1.md')), false);
  assert.deepEqual(gitLog(repo.config.kbDir), ['Inicia la base de conocimiento de estudio']);
});

test('a failed commit restores files already in the repository and commits only its own paths', async t => {
  fakeKbol(t);
  const repo = await tempKb(t);
  const file = { path: 'kb/entidades/ENT-1.md', text: renderRecord(entidad('ENT-1', 'SWaT'), '# SWaT') };
  await repo.commit([file], 'Añade SWaT');
  // The same content again: git has nothing to commit and the batch fails.
  await assert.rejects(repo.commit([file], 'Otra vez'));
  assert.equal(repo.get('ENT-1')?.header.nombre, 'SWaT', 'the committed record is still there');
  fs.writeFileSync(path.join(repo.config.kbDir, 'notas.txt'), 'mío');
  childProcess.execFileSync('git', ['add', 'notas.txt'], { cwd: repo.config.kbDir });
  await repo.commit([{ path: 'kb/entidades/ENT-2.md', text: renderRecord(entidad('ENT-2', 'WADI'), '# WADI') }], 'Añade WADI');
  const changed = childProcess.execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo.config.kbDir, encoding: 'utf8' }).trim();
  assert.equal(changed, 'kb/entidades/ENT-2.md');
});
