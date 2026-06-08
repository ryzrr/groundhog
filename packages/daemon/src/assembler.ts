import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { GCBSnapshot, DaemonStatus, FileEvent, GitEvent, ShellEvent, ActivityEntry } from '@groundhog/shared';
import type { Storage } from './storage.js';
import type { ProjectRegistry } from './projects.js';
import { extractFields, type Signals } from './extractor.js';
import { computeConfidence } from './confidence.js';
import { log } from './log.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_MS   = 60_000;   // assemble every 60s
const PRUNE_MS       = 5 * 60_000;
const EVENT_MAX_AGE  = 2 * 60 * 60_000;  // keep 2h of events
const RING_MAX       = 200;               // max events per buffer

// ─── Helpers ─────────────────────────────────────────────────────────────────

function estimateTokens(fields: {
  task: string; stack: string; next: string;
  projectDesc?: string; arch?: string; changed?: string; recentCommits?: string;
  error?: string; tried?: string; resolved?: string;
}): number {
  const text = [
    fields.projectDesc, fields.arch,
    fields.task, fields.stack,
    fields.changed, fields.recentCommits,
    fields.resolved, fields.error, fields.tried, fields.next,
  ].filter(Boolean).join(' ');
  return Math.round(text.length / 4) + 40;
}

function snapshotHash(snap: { task: string; stack: string; error?: string; resolved?: string }): string {
  const sig = `${snap.task}|${snap.stack}|${snap.error ?? ''}|${snap.resolved ?? ''}`;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

function pushRing<T extends { ts: number }>(buf: T[], item: T): T[] {
  buf.push(item);
  if (buf.length > RING_MAX) buf.shift();
  return buf;
}

function pruneOld<T extends { ts: number }>(buf: T[], now: number): T[] {
  return buf.filter(e => (now - e.ts) < EVENT_MAX_AGE);
}

// ─── ContextAssembler ─────────────────────────────────────────────────────────

export class ContextAssembler {
  private fileEvents  = new Map<string, FileEvent[]>();   // keyed by project path
  private gitEvents   = new Map<string, GitEvent[]>();
  private shellEvents: ShellEvent[] = [];                 // global (per-machine)

  private lastHashes  = new Map<string, string>();        // project path → last snapshot hash
  private lastSaved   = new Map<string, number>();        // project path → timestamp

  private status: DaemonStatus = 'watching';
  private heartbeat: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private storage: Storage,
    private registry: ProjectRegistry,
  ) {}

  // ─── Signal ingestion ───────────────────────────────────────────────────

  onFileEvent(e: FileEvent): void {
    if (this.status !== 'watching') return;
    const project = this.registry.getProjectForPath(e.path);
    if (!project) return;
    const buf = this.fileEvents.get(project.path) ?? [];
    this.fileEvents.set(project.path, pushRing(buf, e));
  }

  onGitEvent(e: GitEvent): void {
    if (this.status !== 'watching') return;
    const project = this.registry.getProjects().find(p => p.name === e.project);
    if (!project) return;
    const buf = this.gitEvents.get(project.path) ?? [];
    this.gitEvents.set(project.path, pushRing(buf, e));

    // Git event → trigger assembly with 500ms debounce
    this._scheduleAssembly(project.path);
  }

  onShellEvent(e: ShellEvent): void {
    if (this.status !== 'watching') return;
    pushRing(this.shellEvents, e);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  start(): void {
    this.heartbeat  = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    this.pruneTimer = setInterval(() => this._prune(), PRUNE_MS);
    // Run initial assembly for all known projects
    setTimeout(() => this._heartbeat(), 3000);
  }

  stop(): void {
    if (this.heartbeat)  { clearInterval(this.heartbeat);  this.heartbeat  = null; }
    if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  pause(): void  { this.status = 'paused';   log('info', 'Assembler paused'); }
  resume(): void { this.status = 'watching'; log('info', 'Assembler resumed'); }

  // ─── Explicit snap (IPC request) ───────────────────────────────────────

  assembleNow(projectName: string): GCBSnapshot {
    const project = this.registry.getProjects().find(p => p.name === projectName);
    if (!project) {
      // Return last stored snapshot if we have it, else synthesize a minimal one
      const stored = this.storage.getLatestSnapshot(projectName);
      if (stored) return stored;
      throw new Error(`Project '${projectName}' not found`);
    }
    return this._assembleProject(project.path, project.name, true) ??
           this.storage.getLatestSnapshot(projectName) ??
           this._emptySnapshot(projectName);
  }

  // ─── Activity feed (for IPC activity) ────────────────────────────────────

  getRecentActivity(projectName: string, limit: number): ActivityEntry[] {
    const project = this.registry.getProjects().find(p => p.name === projectName);
    const entries: ActivityEntry[] = [];

    if (project) {
      for (const e of (this.fileEvents.get(project.path) ?? [])) {
        const rel = path.relative(project.path, e.path).replace(/\\/g, '/');
        // Skip node_modules symlink duplicates (pnpm workspace symlinks)
        if (rel.startsWith('node_modules/') || rel.includes('/node_modules/')) continue;
        entries.push({ type: 'file', label: rel, kind: e.type, ts: e.ts });
      }
      for (const e of (this.gitEvents.get(project.path) ?? [])) {
        entries.push({ type: 'commit', label: e.message ? e.message.slice(0, 80) : `branch → ${e.branch}`, ts: e.ts });
      }
    }

    // Shell events are global (same machine, any directory)
    for (const e of this.shellEvents) {
      entries.push({ type: 'shell', label: e.command, ts: e.ts });
    }

    return entries.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  // ─── Most-active project (used by IPC status) ────────────────────────────

  getMostActiveProject(): string | null {
    let bestName: string | null = null;
    let bestTs = 0;

    // Prefer in-memory file events (most live signal)
    for (const [projectPath, events] of this.fileEvents) {
      if (events.length === 0) continue;
      const latest = events[events.length - 1]!.ts;
      if (latest > bestTs) {
        bestTs = latest;
        const p = this.registry.getProjects().find(r => r.path === projectPath);
        if (p) bestName = p.name;
      }
    }

    if (bestName) return bestName;

    // No live events yet — use the project with the most recently stored snapshot
    for (const p of this.registry.getProjects()) {
      const snap = this.storage.getLatestSnapshot(p.name);
      if (snap && snap.createdAt.getTime() > bestTs) {
        bestTs = snap.createdAt.getTime();
        bestName = p.name;
      }
    }

    return bestName ?? this.registry.getActiveProject()?.name ?? null;
  }

  // ─── State query (for IPC status) ────────────────────────────────────

  getState(): { status: DaemonStatus; projects: string[] } {
    return {
      status:   this.status,
      projects: this.registry.getProjects().map(p => p.name),
    };
  }

  // ─── Internal assembly ────────────────────────────────────────────────

  private _heartbeat(): void {
    for (const project of this.registry.getProjects()) {
      try {
        this._assembleProject(project.path, project.name, false);
      } catch (err) {
        log('error', `Assembly failed for ${project.name}: ${String(err)}`);
      }
    }
  }

  private _scheduleAssembly(projectPath: string): void {
    const existing = this.debounceTimers.get(projectPath);
    if (existing) clearTimeout(existing);
    const project = this.registry.getProjects().find(p => p.path === projectPath);
    if (!project) return;
    const t = setTimeout(() => {
      this.debounceTimers.delete(projectPath);
      try { this._assembleProject(projectPath, project.name, false); } catch {}
    }, 500);
    this.debounceTimers.set(projectPath, t);
  }

  private _assembleProject(
    projectPath: string,
    projectName: string,
    force: boolean
  ): GCBSnapshot | null {
    if (this.status !== 'watching' && !force) return null;

    const now = Date.now();
    const signals: Signals = {
      gitEvents:   this.gitEvents.get(projectPath)  ?? [],
      fileEvents:  this.fileEvents.get(projectPath) ?? [],
      shellEvents: this.shellEvents,
      projectPath,
      projectName,
    };

    const fields     = extractFields(signals);
    const confidence = computeConfidence(fields, signals, now);
    const tokens     = estimateTokens(fields);
    const newHash    = snapshotHash(fields);

    const lastHash    = this.lastHashes.get(projectPath);
    const lastSavedAt = this.lastSaved.get(projectPath) ?? 0;
    const ONE_HOUR    = 60 * 60_000;

    const shouldSave = force
      || !lastHash                         // first ever snapshot
      || newHash !== lastHash              // content changed
      || (now - lastSavedAt) > ONE_HOUR;  // forced periodic save

    if (!shouldSave) return this.storage.getLatestSnapshot(projectName);

    const snap = this.storage.saveSnapshot({
      project:        projectName,
      createdAt:      new Date(now),
      tokens,
      confidence,
      task:           fields.task,
      stack:          fields.stack,
      projectDesc:    fields.projectDesc,
      arch:           fields.arch,
      changed:        fields.changed,
      recentCommits:  fields.recentCommits,
      resolved:       fields.resolved,
      error:          fields.error,
      tried:          fields.tried,
      open:           fields.open,
      next:           fields.next,
    });

    this.lastHashes.set(projectPath, newHash);
    this.lastSaved.set(projectPath, now);
    return snap;
  }

  private _prune(): void {
    const now = Date.now();
    for (const [k, buf] of this.fileEvents) this.fileEvents.set(k, pruneOld(buf, now));
    for (const [k, buf] of this.gitEvents)  this.gitEvents.set(k,  pruneOld(buf, now));
    this.shellEvents = pruneOld(this.shellEvents, now);
  }

  private _emptySnapshot(projectName: string): GCBSnapshot {
    return {
      id: crypto.randomUUID(), project: projectName, createdAt: new Date(),
      tokens: 40, confidence: 0.4,
      task: 'Active development session', stack: '', next: 'Continue working',
    };
  }
}
