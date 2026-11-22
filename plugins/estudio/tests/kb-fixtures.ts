import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { openKbRepo, type KbRepo } from '../src/kb/repo.ts';

const realSpawn = childProcess.spawn;

/**
 * Replaces only `uv` (KBOL's validator, the external boundary) with a script that prints KBOL's envelope;
 * git runs for real. A record whose text contains `INVALIDO` is rejected, like a schema error.
 */
export function fakeKbol(t: TestContext): { calls: string[][] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-fakekbol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'kbol.mjs');
  fs.writeFileSync(script, `
    import fs from 'node:fs';
    const file = process.argv.at(-1);
    const bad = fs.readFileSync(file, 'utf8').includes('INVALIDO');
    process.stdout.write(JSON.stringify({ operacion: 'validar', resultado: { estado: bad ? 'fallido' : 'completado', errores: bad ? ['campo desconocido: INVALIDO'] : [] } }));
  `);
  const calls: string[][] = [];
  const fake = (command: string, args: string[], options: childProcess.SpawnOptions) => {
    if (command !== 'uv') return realSpawn(command, args, options);
    calls.push(args);
    return realSpawn(process.execPath, [script, ...args], { ...options, cwd: dir });
  };
  t.mock.method(childProcess, 'spawn', fake as never);
  return { calls };
}

export async function tempKb(t: TestContext): Promise<KbRepo> {
  const kbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-kb-'));
  t.after(() => fs.rmSync(kbDir, { recursive: true, force: true }));
  const repo = openKbRepo({ kbDir, kbolDir: kbDir, uv: 'uv' }, () => '2026-11-11T10:00:00.000Z');
  await repo.ensureInitialized();
  return repo;
}
