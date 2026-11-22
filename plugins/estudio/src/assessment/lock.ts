import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { assertDirectoryIdentity, fail, readBounded, sameFile, syncDirectory, unlinkOwned } from './files.ts';

export type WriterLease = { assertOwned(): Promise<void>; release(): Promise<void> };

const LOCK_CONTENT = /^(\d{1,10}):[0-9a-f]{64}$/;

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as { code?: string }).code !== 'ESRCH'; }
}

/** A lock whose recorded owner process no longer exists was left by a crash or a forced
 * close of the desktop app. Any lock that cannot be attributed to a dead process stays. */
async function removeIfOwnerDead(file: string): Promise<boolean> {
  let content: string | null;
  try { content = await readBounded(file, 1024); } catch { return false; }
  if (content === null) return false;
  const match = LOCK_CONTENT.exec(content);
  if (!match) return false;
  const pid = Number(match[1]);
  if (pid === process.pid || processAlive(pid)) return false;
  const stats = await fs.lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) return false;
  await unlinkOwned(file, stats);
  return true;
}

// The lock records its owner's PID. A lock left by a process that no longer exists is
// removed once on open; a live owner, our own process or an unattributable lock is never stolen.
export async function acquireWriter(root: string, rootIdentity: Stats): Promise<WriterLease> {
  const file = path.join(root, '.assessment-store.lock');
  await assertDirectoryIdentity(root, rootIdentity);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  for (let attempt = 0; handle === undefined; attempt++) {
    try {
      handle = await fs.open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EEXIST' && attempt === 0 && await removeIfOwnerDead(file)) continue;
      if (code === 'EEXIST' || code === 'ELOOP') {
        fail('STORE_LOCKED', 'Assessment writer lock is held by a running process or cannot be attributed to a stopped one');
      }
      throw error;
    }
  }
  const identity = await handle.stat();
  const token = `${process.pid}:${randomBytes(32).toString('hex')}`;
  try {
    await handle.writeFile(token, 'utf8');
    await handle.sync();
    await assertDirectoryIdentity(root, rootIdentity);
    await syncDirectory(root);
  } catch (error) {
    await handle.close();
    await assertDirectoryIdentity(root, rootIdentity);
    await unlinkOwned(file, identity);
    throw error;
  }
  let released = false;
  async function assertOwned(): Promise<void> {
    if (released) fail('STORE_LOCKED', 'Writer lease is closed');
    await assertDirectoryIdentity(root, rootIdentity);
    let current: Stats;
    try { current = await fs.lstat(file); } catch { fail('STORE_LOCKED', 'Writer lock disappeared; close and inspect the store'); }
    if (current.isSymbolicLink() || !current.isFile() || !sameFile(identity, current)) fail('STORE_LOCKED', 'Writer lock ownership changed');
    if (await readBounded(file, 1024) !== token) fail('STORE_LOCKED', 'Writer lock token changed');
  }
  return {
    assertOwned,
    async release() {
      if (released) return;
      try { await assertOwned(); }
      catch (error) { released = true; await handle.close(); throw error; }
      released = true;
      await handle.close();
      await assertDirectoryIdentity(root, rootIdentity);
      await unlinkOwned(file, identity);
      await syncDirectory(root);
    },
  };
}
