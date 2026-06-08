import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Storage } from './storage.js';
import { log } from './log.js';

const MAX_PROJECTS = 30;
const CONFIG_KEY   = 'projects_registry';
const ACTIVE_KEY   = 'active_project';

export interface ProjectRecord {
  name: string;    // basename of project root
  path: string;    // absolute resolved path
  addedAt: number; // Date.now()
  hasGit: boolean; // false for dirs without .git — file/shell signals only
}

// ─── Git-root detection ───────────────────────────────────────────────────────

// Walk up from dir (max maxUp levels) looking for a .git directory.
// Returns the git root path, or null if not found.
function findGitRoot(dir: string, maxUp = 4): string | null {
  let current = path.resolve(dir);
  for (let i = 0; i <= maxUp; i++) {
    try {
      if (fs.existsSync(path.join(current, '.git'))) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return null;
}

// Returns the mtime of the last commit in a git repo (via COMMIT_EDITMSG), or 0 if no commits.
function lastCommitMs(dir: string): number {
  try { return fs.statSync(path.join(dir, '.git', 'COMMIT_EDITMSG')).mtimeMs; } catch { return 0; }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Return all immediate children that are git roots with recent activity (last 30 days).
// cwd is always included regardless of recency.
function scanDir(dir: string, cwd: string): string[] {
  const roots: string[] = [];
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  const isRecent = (d: string) =>
    d === cwd || path.resolve(d) === path.resolve(cwd) || lastCommitMs(d) >= cutoff;

  // Check dir itself
  const selfRoot = findGitRoot(dir, 0);
  if (selfRoot && isRecent(selfRoot)) roots.push(selfRoot);
  // Check one level deep
  try {
    const children = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of children) {
      if (!entry.isDirectory()) continue;
      const childPath = path.join(dir, entry.name);
      if (fs.existsSync(path.join(childPath, '.git')) && isRecent(childPath)) {
        roots.push(childPath);
      }
    }
  } catch {}
  return roots;
}

// Compute seed directories for the current platform
export function getDefaultSeedDirs(): string[] {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'source', 'repos'),
        path.join(home, 'Projects'),
        path.join(home, 'dev'),
      ]
    : [
        path.join(home, 'dev'),
        path.join(home, 'projects'),
        path.join(home, 'src'),
        path.join(home, 'code'),
        path.join(home, 'work'),
      ];
  // Always include cwd
  candidates.push(process.cwd());
  return candidates.filter(d => { try { return fs.existsSync(d); } catch { return false; } });
}

// ─── ProjectRegistry ──────────────────────────────────────────────────────────

export class ProjectRegistry {
  private projects = new Map<string, ProjectRecord>(); // keyed by resolved path
  private newProjectHandlers: Array<(p: ProjectRecord) => void> = [];
  private storage: Storage | null = null;

  // ─── Load / persist ────────────────────────────────────────────────────────

  load(storage: Storage): void {
    this.storage = storage;
    const raw = storage.getConfig(CONFIG_KEY);
    if (raw) {
      try {
        const arr = JSON.parse(raw) as Array<Partial<ProjectRecord> & { path: string; name: string }>;
        for (const p of arr) {
          if (p.path && p.name) {
            this.projects.set(p.path, {
              ...p,
              addedAt: p.addedAt ?? Date.now(),
              // Derive hasGit from filesystem — more reliable than stored value
              hasGit: fs.existsSync(path.join(p.path, '.git')),
            });
          }
        }
        log('info', `Loaded ${this.projects.size} project(s) from storage`);
      } catch {}
    }
  }

  save(): void {
    if (!this.storage) return;
    this.storage.setConfig(CONFIG_KEY, JSON.stringify([...this.projects.values()]));
  }

  // ─── Discovery ─────────────────────────────────────────────────────────────

  async discover(seedDirs: string[]): Promise<void> {
    const seen = new Set<string>();
    const cwd = process.cwd();

    // Always include cwd — git or not — so the user's active directory is always tracked
    seen.add(path.resolve(findGitRoot(cwd) ?? cwd));

    for (const seed of seedDirs) {
      for (const root of scanDir(seed, cwd)) {
        seen.add(path.resolve(root));
      }
    }
    for (const resolved of seen) {
      await this._register(resolved, false);
    }
    this.save();
    log('info', `Discovered ${this.projects.size} project(s)`);
  }

  // ─── Dynamic registration (from cd commands) ───────────────────────────────

  async tryRegisterPath(dirPath: string): Promise<ProjectRecord | null> {
    // Prefer the git root; fall back to the directory itself if no git
    const root = findGitRoot(dirPath) ?? dirPath;
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved)) return null;
    if (this.projects.has(resolved)) return this.projects.get(resolved)!;
    return this._register(resolved, true);
  }

  // ─── Callbacks ─────────────────────────────────────────────────────────────

  onNewProject(handler: (p: ProjectRecord) => void): void {
    this.newProjectHandlers.push(handler);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  getProjects(): ProjectRecord[] {
    return [...this.projects.values()];
  }

  getActiveProject(): ProjectRecord | null {
    if (!this.storage) return this.projects.values().next().value ?? null;
    const name = this.storage.getConfig(ACTIVE_KEY);
    if (!name) return this.projects.values().next().value ?? null;
    return [...this.projects.values()].find(p => p.name === name) ?? null;
  }

  setActiveProject(name: string): void {
    this.storage?.setConfig(ACTIVE_KEY, name);
  }

  // Returns the project whose path is the longest prefix of filePath
  getProjectForPath(filePath: string): ProjectRecord | null {
    let best: ProjectRecord | null = null;
    let bestLen = -1;
    for (const p of this.projects.values()) {
      if (filePath.startsWith(p.path) && p.path.length > bestLen) {
        best    = p;
        bestLen = p.path.length;
      }
    }
    return best;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _register(resolvedPath: string, notify: boolean): Promise<ProjectRecord | null> {
    if (this.projects.has(resolvedPath)) return this.projects.get(resolvedPath)!;
    if (this.projects.size >= MAX_PROJECTS) {
      log('warn', `Project cap (${MAX_PROJECTS}) reached — not watching ${resolvedPath}`);
      return null;
    }
    const hasGit = fs.existsSync(path.join(resolvedPath, '.git'));
    const record: ProjectRecord = {
      name:    path.basename(resolvedPath),
      path:    resolvedPath,
      addedAt: Date.now(),
      hasGit,
    };
    this.projects.set(resolvedPath, record);
    this.save();
    log('info', `Registered project: ${record.name} (${hasGit ? 'git' : 'no-git'}) at ${record.path}`);
    if (notify) {
      for (const h of this.newProjectHandlers) {
        try { h(record); } catch {}
      }
    }
    return record;
  }
}
