#!/usr/bin/env node
// Groundhog daemon — orchestrator.
// Wires all modules together, handles OS signals, manages startup/shutdown lifecycle.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { log }                      from './log.js';
import { loadKey }                  from './keychain.js';
import { writePid, clearPid, DaemonAlreadyRunningError } from './pid.js';
import { Storage }                  from './storage.js';
import { ProjectRegistry, getDefaultSeedDirs } from './projects.js';
import { ContextAssembler }         from './assembler.js';
import { FileWatcher }              from './watcher.js';
import { createGitPoller }          from './git.js';
import { ShellHistoryPoller }       from './shell.js';
import { IpcServer }                from './ipc.js';
import type { GitPoller }           from './git.js';

const GROUNDHOG_DIR = path.join(os.homedir(), '.groundhog');
const DB_PATH       = path.join(GROUNDHOG_DIR, 'groundhog.db');

async function main(): Promise<void> {
  // 1. Ensure ~/.groundhog/ exists
  await fs.promises.mkdir(GROUNDHOG_DIR, { recursive: true });

  // 2. Load encryption key
  const key = await loadKey();

  // 3. Write PID file — exit if another instance is already running
  try {
    await writePid(process.pid);
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  // 4. Initialize storage (async: tries better-sqlite3, falls back to sql.js WASM)
  const storage = await Storage.create(DB_PATH, key);

  // 5. Discover projects
  const registry = new ProjectRegistry();
  registry.load(storage);
  const seedDirs = getDefaultSeedDirs();
  await registry.discover(seedDirs);

  // 6. Create assembler
  const assembler = new ContextAssembler(storage, registry);

  // 7. Start file watcher
  const watcher = new FileWatcher({
    dirs: registry.getProjects().map(p => p.path),
  });
  watcher.on('file', e => assembler.onFileEvent(e));
  await watcher.start();

  // 8. Start git poller per project (only for git repos)
  const gitPollers = new Map<string, GitPoller>();
  for (const project of registry.getProjects()) {
    if (!project.hasGit) continue;
    const poller = createGitPoller(project.path, project.name);
    poller.start(5000, e => assembler.onGitEvent(e));
    gitPollers.set(project.path, poller);
  }

  // 9. Start shell history poller
  const shellPoller = new ShellHistoryPoller();
  shellPoller.start(2000, e => assembler.onShellEvent(e));

  // 10. Wire dynamic project discovery:
  //     shell cd → registry → watcher + git poller hot-add
  shellPoller.onCdCommand(async (dir) => {
    try {
      const newProject = await registry.tryRegisterPath(dir);
      if (newProject) {
        watcher.addDir(newProject.path);
        if (newProject.hasGit && !gitPollers.has(newProject.path)) {
          const poller = createGitPoller(newProject.path, newProject.name);
          poller.start(5000, e => assembler.onGitEvent(e));
          gitPollers.set(newProject.path, poller);
        }
      }
    } catch {}
  });

  // Hot-add new projects discovered via registry.onNewProject callbacks from discovery
  registry.onNewProject(async (project) => {
    watcher.addDir(project.path);
    if (project.hasGit && !gitPollers.has(project.path)) {
      const poller = createGitPoller(project.path, project.name);
      poller.start(5000, e => assembler.onGitEvent(e));
      gitPollers.set(project.path, poller);
    }
  });

  // 11. Start assembler heartbeat
  assembler.start();

  // 12. Start IPC server
  const ipcServer = new IpcServer(assembler, storage, registry);
  await ipcServer.start();

  // 13. Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    log('info', `Shutdown signal: ${signal}`);
    process.stderr.write(`[groundhog] Daemon shutting down (${signal})\n`);
    try {
      await ipcServer.stop();
      assembler.stop();
      for (const p of gitPollers.values()) p.stop();
      shellPoller.stop();
      await watcher.stop();
      storage.close();
      await clearPid();
    } catch (err) {
      log('error', `Shutdown error: ${String(err)}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(0)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(0)); });
  // Windows: SIGHUP for terminal close; SIGTERM may not fire reliably
  process.on('SIGHUP',  () => { shutdown('SIGHUP').catch(() => process.exit(0)); });

  // 14. Resilience: uncaught exceptions must NOT kill the daemon
  process.on('uncaughtException', (err) => {
    log('error', `[uncaughtException] ${err.stack ?? err.message}`);
    process.stderr.write(`[groundhog] uncaughtException: ${err.message}\n`);
    // Daemon stays alive — individual module errors are contained
  });

  process.on('unhandledRejection', (reason) => {
    log('error', `[unhandledRejection] ${String(reason)}`);
  });

  log('info', `Daemon started (PID ${process.pid})`);
  process.stderr.write(`[groundhog] Daemon started (PID ${process.pid})\n`);
}

main().catch(err => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[groundhog] Fatal startup error: ${msg}\n`);
  process.exit(1);
});
