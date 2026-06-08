import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IpcRequest, IpcResponse } from '@groundhog/shared';

export const IPC_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\groundhog'
    : path.join(os.homedir(), '.groundhog', 'groundhog.sock');

export class DaemonOfflineError extends Error {
  constructor() { super('Daemon is not running. Run `groundhog init` to start it.'); }
}
export class DaemonTimeoutError extends Error {
  constructor() { super('Daemon did not respond within the timeout period.'); }
}

export class DaemonClient {
  send<T extends IpcResponse>(req: IpcRequest, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(IPC_PATH);
      let buf = '';
      let settled = false;

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };

      const timer = setTimeout(() => {
        done(() => reject(new DaemonTimeoutError()));
      }, timeoutMs);

      socket.on('connect', () => {
        socket.write(JSON.stringify(req) + '\n');
      });

      socket.on('data', chunk => {
        buf += chunk.toString('utf8');
        const nl = buf.indexOf('\n');
        if (nl !== -1) {
          const line = buf.slice(0, nl).trim();
          try {
            // Revive createdAt strings to Date objects (JSON.parse returns strings for Date fields)
            done(() => resolve(JSON.parse(line, (k, v) =>
              k === 'createdAt' && typeof v === 'string' ? new Date(v) : v
            ) as T));
          } catch {
            done(() => reject(new Error('Daemon sent invalid JSON')));
          }
        }
      });

      socket.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          done(() => reject(new DaemonOfflineError()));
        } else {
          done(() => reject(err));
        }
      });
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.send({ cmd: 'status' }, 2000);
      return true;
    } catch {
      return false;
    }
  }
}
