import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from './daemon-client.js';

// Shared by Init (first-time setup) and Unblock (restart after a block) — both
// need to locate and spawn the daemon process identically.

export function getDaemonPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // works for both apps/cli/src/ (dev) and apps/cli/dist/ (prod)
  return path.resolve(here, '..', '..', '..', 'packages', 'daemon', 'dist', 'index.js');
}

export async function runSpawnDaemon(): Promise<number> {
  // If already running, return existing PID
  const client = new DaemonClient();
  const alive = await client.ping();
  if (alive) {
    const resp = await client.send({ cmd: 'status' }) as { ok: true; state: { pid: number } };
    if (resp.ok) return resp.state.pid;
  }

  const daemonPath = getDaemonPath();
  const child = child_process.spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll for PID file (200ms intervals, 15s timeout)
  const pidPath = path.join(os.homedir(), '.groundhog', 'daemon.pid');
  for (let i = 0; i < 75; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      if (!isNaN(pid) && pid > 0) return pid;
    } catch {}
  }
  throw new Error('Daemon did not start within 15 seconds.');
}
