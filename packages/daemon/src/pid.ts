import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PID_PATH = path.join(os.homedir(), '.groundhog', 'daemon.pid');

export class DaemonAlreadyRunningError extends Error {
  constructor(public readonly existingPid: number) {
    super(`Groundhog daemon already running (PID ${existingPid}). Run 'groundhog block' to stop it first.`);
    this.name = 'DaemonAlreadyRunningError';
  }
}

export function getPidPath(): string {
  return PID_PATH;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readPid(): Promise<number | null> {
  try {
    const content = await fs.promises.readFile(PID_PATH, 'utf8');
    const pid = parseInt(content.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function clearPid(): Promise<void> {
  try { await fs.promises.unlink(PID_PATH); } catch {}
}

export async function writePid(pid: number): Promise<void> {
  const dir = path.dirname(PID_PATH);
  await fs.promises.mkdir(dir, { recursive: true });
  await _writePidAtomic(pid, false);
}

async function _writePidAtomic(pid: number, isRetry: boolean): Promise<void> {
  let fd: fs.promises.FileHandle | undefined;
  try {
    fd = await fs.promises.open(PID_PATH, 'wx');
    await fd.writeFile(String(pid), 'utf8');
  } catch (err: any) {
    if (err.code !== 'EEXIST' || isRetry) throw err;

    // File exists — check if the existing process is still alive
    const existingPid = await readPid();
    if (existingPid !== null && isProcessAlive(existingPid)) {
      throw new DaemonAlreadyRunningError(existingPid);
    }

    // Stale PID file — remove and retry once
    await clearPid();
    await _writePidAtomic(pid, true);
  } finally {
    await fd?.close();
  }
}
