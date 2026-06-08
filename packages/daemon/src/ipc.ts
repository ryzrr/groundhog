import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { IpcRequest, IpcResponse } from '@groundhog/shared';
import type { ContextAssembler } from './assembler.js';
import type { Storage } from './storage.js';
import type { ProjectRegistry } from './projects.js';
import { log } from './log.js';

// ─── Socket path ──────────────────────────────────────────────────────────────

export const IPC_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\groundhog'
  : path.join(os.homedir(), '.groundhog', 'groundhog.sock');

// ─── IpcServer ────────────────────────────────────────────────────────────────

export class IpcServer {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();

  constructor(
    private assembler: ContextAssembler,
    private storage:   Storage,
    private registry:  ProjectRegistry,
  ) {}

  async start(): Promise<void> {
    // On Unix: remove stale socket file from a previous crash
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(IPC_PATH); } catch {}
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer(socket => this._handleConnection(socket));

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && process.platform !== 'win32') {
          log('warn', 'IPC socket in use — removing stale socket and retrying');
          try { fs.unlinkSync(IPC_PATH); } catch {}
          this.server!.listen(IPC_PATH, resolve);
        } else {
          reject(err);
        }
      });

      this.server.listen(IPC_PATH, () => {
        log('info', `IPC server listening at ${IPC_PATH}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      try { socket.destroy(); } catch {}
    }
    this.sockets.clear();
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  // ─── Connection handling ─────────────────────────────────────────────────

  private _handleConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', (err) => {
      log('debug', `IPC socket error: ${err.message}`);
      this.sockets.delete(socket);
    });

    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this._handleMessage(socket, line);
      }
    });
  }

  // ─── Command dispatch ────────────────────────────────────────────────────

  private _handleMessage(socket: net.Socket, jsonLine: string): void {
    let req: IpcRequest;
    try {
      req = JSON.parse(jsonLine) as IpcRequest;
    } catch {
      this._send(socket, { ok: false, error: 'Invalid JSON' });
      return;
    }

    try {
      switch (req.cmd) {
        case 'status': {
          const state       = { ...this.assembler.getState(), pid: process.pid };
          const activeName  = this.assembler.getMostActiveProject();
          const snapshot    = activeName ? this.storage.getLatestSnapshot(activeName) : null;
          this._send(socket, { ok: true, state, snapshot });
          break;
        }

        case 'snap': {
          const snapshot = this.assembler.assembleNow(req.project);
          this._send(socket, { ok: true, snapshot });
          break;
        }

        case 'pause':
          this.assembler.pause();
          this._send(socket, { ok: true });
          break;

        case 'resume':
          this.assembler.resume();
          this._send(socket, { ok: true });
          break;

        case 'history': {
          const snapshots = this.storage.getSnapshots(req.project, req.limit ?? 20);
          this._send(socket, { ok: true, snapshots });
          break;
        }

        case 'projects': {
          const projects = this.registry.getProjects().map(p => {
            const snap = this.storage.getLatestSnapshot(p.name);
            return {
              name:       p.name,
              path:       p.path,
              branch:     '',           // filled in by git poller state, not stored here
              lastSnap:   snap?.createdAt ?? null,
              confidence: snap?.confidence ?? 0,
            };
          });
          this._send(socket, { ok: true, projects });
          break;
        }

        case 'activity': {
          const entries = this.assembler.getRecentActivity(req.project, req.limit ?? 30);
          this._send(socket, { ok: true, entries });
          break;
        }

        case 'stop':
          this._send(socket, { ok: true });
          log('info', 'IPC stop command received — shutting down');
          setImmediate(() => process.emit('SIGTERM'));
          break;

        default:
          this._send(socket, { ok: false, error: `Unknown command: ${(req as { cmd: string }).cmd}` });
      }
    } catch (err) {
      log('error', `IPC handler error: ${String(err)}`);
      this._send(socket, { ok: false, error: String(err) });
    }
  }

  private _send(socket: net.Socket, response: IpcResponse | (IpcResponse & { state?: { pid: number } })): void {
    if (!socket.writable) return;
    try {
      socket.write(JSON.stringify(response) + '\n');
    } catch {}
  }
}
