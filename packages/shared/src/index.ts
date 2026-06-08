// Groundhog shared types — canonical data model, IPC protocol, signal types, and GCB serializer.

// ─── Core snapshot ────────────────────────────────────────────────────────────

export interface GCBSnapshot {
  id: string;
  project: string;
  createdAt: Date;
  tokens: number;
  confidence: number;
  // ── Context-shift fields ────────────────────────────────────────────────
  projectDesc?:    string;  // one-liner from package.json description / README
  arch?:           string;  // monorepo packages summary (name + description)
  task: string;
  stack: string;
  changed?:        string;  // recently modified files (last 1h, relative paths)
  recentCommits?:  string;  // last 3 commit messages (last 7 days)
  resolved?: string;
  error?: string;
  tried?: string;
  open?: string;
  next: string;
}

export type DaemonStatus = 'watching' | 'paused' | 'blocked' | 'offline';

export interface DaemonState {
  pid: number | null;
  status: DaemonStatus;
  projects: string[];
}

// ─── IPC protocol ─────────────────────────────────────────────────────────────

export type IpcRequest =
  | { cmd: 'status' }
  | { cmd: 'snap'; project: string }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'stop' }
  | { cmd: 'history'; project: string; limit: number }
  | { cmd: 'projects' }
  | { cmd: 'activity'; project: string; limit?: number };

export type IpcResponse =
  | { ok: true; state: DaemonState; snapshot: GCBSnapshot | null }  // status
  | { ok: true; snapshot: GCBSnapshot }                              // snap
  | { ok: true }                                                     // pause/resume/stop
  | { ok: true; snapshots: GCBSnapshot[] }                          // history
  | { ok: true; projects: ProjectInfo[] }                           // projects
  | { ok: true; entries: ActivityEntry[] }                          // activity
  | { ok: false; error: string };

export interface ActivityEntry {
  type: 'file' | 'shell' | 'commit';
  label: string;   // relative path (file), command text (shell), commit message (commit)
  kind?: string;   // 'change'|'add'|'unlink' for file events
  ts: number;
}

export interface ProjectInfo {
  name: string;
  path: string;
  branch: string;
  lastSnap: Date | null;
  confidence: number;
}

// ─── Raw signal types (produced by watcher/git/shell, consumed by assembler) ─

export interface FileEvent {
  path: string;
  type: 'add' | 'change' | 'unlink';
  ts: number; // Date.now()
}

export interface GitEvent {
  type: 'commit' | 'branch';
  project: string;
  branch: string;
  message?: string; // only on commit
  hash?: string;
  ts: number;
}

export interface ShellEvent {
  command: string; // already redacted
  ts: number;
}

// ─── GCB text serializer ──────────────────────────────────────────────────────

export function formatGCB(snap: GCBSnapshot): string {
  const date = snap.createdAt.toISOString().split('T')[0];
  const lines: string[] = [`[GH·${snap.project}·${date}]`];

  // ── Project identity (what is this + how is it built) ────────────────────
  if (snap.projectDesc)   lines.push(`PROJECT:  ${snap.projectDesc}`);
  if (snap.arch)          lines.push(`ARCH:     ${snap.arch}`);

  // ── Current session ──────────────────────────────────────────────────────
  lines.push(`TASK:     ${snap.task}`);
  lines.push(`STACK:    ${snap.stack}`);
  if (snap.changed)       lines.push(`CHANGED:  ${snap.changed}`);
  if (snap.recentCommits) lines.push(`COMMITS:  ${snap.recentCommits}`);

  // ── State ────────────────────────────────────────────────────────────────
  if (snap.resolved)      lines.push(`RESOLVED: ${snap.resolved}`);
  if (snap.error)         lines.push(`ERROR:    ${snap.error}`);
  if (snap.tried)         lines.push(`TRIED:    ${snap.tried}`);
  if (snap.open)          lines.push(`OPEN:     ${snap.open}`);
  lines.push(`NEXT:     ${snap.next}`);

  const continueFrom = snap.error ? 'ERROR' : snap.open ? 'OPEN' : 'NEXT';
  lines.push(`[continue from: ${continueFrom}]`);

  return lines.join('\n');
}



