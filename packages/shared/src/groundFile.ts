// .ground.md — the live, human-readable working-context file Groundhog maintains
// in the project root. The daemon appends one timestamped section per heartbeat
// (see assembler.ts); `groundhog snap` compacts the accumulated history down to
// a single current section via compactFile().
//
// Every function here takes a resolved project ROOT PATH, not a project name —
// packages/shared cannot depend on packages/daemon's ProjectRegistry (that would
// be a circular workspace dependency), so callers resolve the path themselves.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GCBSnapshot } from './index.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Path ───────────────────────────────────────────────────────────────────

export function getFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.ground.md');
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitList(value: string): string[] {
  return value.split(';').map(v => v.trim()).filter(Boolean);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?:\s|$)/);
  const s = (m ? m[0] : text).trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// ─── appendSnapshot ───────────────────────────────────────────────────────────
// Note: GCBSnapshot's `arch` (monorepo package summary), `projectDesc`, and
// `recentCommits` fields have no slot in the .ground.md format below — that
// format is intentionally narrower than the old GCB layout (project identity
// isn't a per-session field). `resolved` maps to "Architecture decision" since
// it already carries "decisions made with reasoning" semantics (see formatGCB's
// original RESOLVED field). `branch` and `agentSessions` have no backing signal
// source in the current daemon pipeline — both are simply omitted/empty here;
// that's a known gap, not a bug, and is out of scope for this pass.

function renderSection(projectName: string, snapshot: GCBSnapshot): string {
  const lines: string[] = [
    `## Groundhog Context — ${projectName} — ${formatDateTime(snapshot.createdAt)}`,
    '',
    `**Task:** ${snapshot.task}`,
    `**Stack:** ${snapshot.stack}`,
  ];
  if (snapshot.changed) lines.push(`**Changed files:** ${snapshot.changed}`);
  lines.push('');

  if (snapshot.resolved) {
    lines.push(`**Architecture decision:** ${snapshot.resolved}`, '');
  }
  if (snapshot.error) {
    lines.push(`**Current error:** ${snapshot.error}`, '');
  }
  if (snapshot.tried) {
    lines.push('**Tried and failed:**');
    for (const item of splitList(snapshot.tried)) lines.push(`  - ${item}`);
    lines.push('');
  }
  if (snapshot.open) {
    lines.push(`**Open question:** ${snapshot.open}`, '');
  }

  lines.push(`**Next action:** ${snapshot.next}`);

  return lines.join('\n');
}

export function appendSnapshot(projectRoot: string, snapshot: GCBSnapshot): void {
  try {
    const filePath = getFilePath(projectRoot);
    const exists = fs.existsSync(filePath);
    const section = renderSection(path.basename(projectRoot), snapshot);
    fs.appendFileSync(filePath, (exists ? '\n' : '') + section + '\n', 'utf8');
  } catch {
    // Never throw from a daemon heartbeat call — the daemon must stay alive
    // regardless of filesystem errors (permissions, disk full, etc.).
  }
}

// ─── readFile ─────────────────────────────────────────────────────────────────

export function readFile(projectRoot: string): string {
  try {
    return fs.readFileSync(getFilePath(projectRoot), 'utf8');
  } catch {
    return '';
  }
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
// .ground.md is hand-editable markdown, not a serialization format — parsing
// must never throw, even on content a developer hand-edited into something the
// regexes below don't expect.

interface ParsedSection {
  project: string;
  dateTime: string;   // raw heading text, e.g. "2026-06-24 14:32"
  ts: number;          // best-effort parsed timestamp; falls back to "now" (never dropped as stale)
  task?: string;
  stack?: string;
  changedFiles?: string;
  archDecision?: string;
  currentError?: string;
  triedAndFailed: string[];
  openQuestion?: string;
  nextAction?: string;
  agentSessions: string[];
  historyLines: string[];   // History entries already collapsed by a prior compaction run
}

function parseTs(dateTime: string): number {
  const t = Date.parse(dateTime.replace(' ', 'T'));
  return Number.isNaN(t) ? Date.now() : t;
}

function parseBullets(value: string): string[] {
  return value
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim())
    .filter(Boolean);
}

const FIELD_RE = /\*\*([A-Za-z][A-Za-z ]*):\*\*[ \t]*([\s\S]*?)(?=\n\*\*[A-Za-z][A-Za-z ]*:\*\*|\n*$)/g;

function parseSectionBody(project: string, dateTime: string, body: string): ParsedSection {
  const section: ParsedSection = {
    project, dateTime, ts: parseTs(dateTime),
    triedAndFailed: [], agentSessions: [], historyLines: [],
  };
  try {
    let match: RegExpExecArray | null;
    while ((match = FIELD_RE.exec(body))) {
      const name = match[1]!.trim().toLowerCase();
      const value = (match[2] ?? '').trim();
      switch (name) {
        case 'task':                  section.task = value; break;
        case 'stack':                  section.stack = value; break;
        case 'changed files':          section.changedFiles = value; break;
        case 'architecture decision':  section.archDecision = value; break;
        case 'current error':          section.currentError = value; break;
        case 'tried and failed':       section.triedAndFailed = parseBullets(value); break;
        case 'open question':          section.openQuestion = value; break;
        case 'next action':            section.nextAction = value; break;
        case 'agent sessions':         section.agentSessions = parseBullets(value); break;
        case 'history':                section.historyLines = parseBullets(value); break;
        default: break; // unrecognized bold field — ignored, not fatal
      }
    }
  } catch {
    // Malformed section — `section` already has safe defaults for every field.
  }
  return section;
}

function parseSections(raw: string): ParsedSection[] {
  const HEADING_RE = /^## Groundhog Context — (.+?) — (.+)$/;
  const sections: ParsedSection[] = [];
  let current: { project: string; dateTime: string; bodyLines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    sections.push(parseSectionBody(current.project, current.dateTime, current.bodyLines.join('\n')));
  };

  for (const line of raw.split('\n')) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      current = { project: m[1]!.trim(), dateTime: m[2]!.trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

// ─── Compaction ───────────────────────────────────────────────────────────────
// "Resolved" / "superseded" are heuristics: a later section lacking or differing
// on a field implies the earlier one is closed. This is approximate by design —
// true intent-tracking is out of scope for a regex-based markdown compactor.

interface CompactedView {
  project: string;
  dateTime: string;
  task: string;
  stack: string;
  changedFiles?: string;
  archDecision?: string;
  currentError?: string;
  triedAndFailed: string[];
  openQuestion?: string;
  nextAction: string;
  agentSessions: string[];
  historyLines: string[];
}

function applyCompactionRules(sections: ParsedSection[], now: number): CompactedView {
  if (sections.length === 0) {
    return { project: '', dateTime: '', task: '', stack: '', nextAction: '', triedAndFailed: [], agentSessions: [], historyLines: [] };
  }
  const latest = sections[sections.length - 1]!;

  // Current error: most recent section that defines one — always treated as open,
  // regardless of age (KEEP rule: "never truncate, never drop while open").
  let errorSectionIdx = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i]!.currentError) { errorSectionIdx = i; break; }
  }
  const currentError = errorSectionIdx >= 0 ? sections[errorSectionIdx]!.currentError : undefined;

  // Tried-and-failed tied to the still-open error: collect from the open-error
  // section forward only; anything before that belongs to already-resolved errors.
  const triedAndFailed: string[] = [];
  const seenTried = new Set<string>();
  if (errorSectionIdx >= 0) {
    for (let i = errorSectionIdx; i < sections.length; i++) {
      for (const t of sections[i]!.triedAndFailed) {
        if (!seenTried.has(t)) { seenTried.add(t); triedAndFailed.push(t); }
      }
    }
  }

  const historyLines: string[] = [];

  // Resolved errors (every error-bearing section strictly before the open one,
  // or all of them if nothing is currently open) collapse to one line each.
  const errorBoundary = errorSectionIdx >= 0 ? errorSectionIdx : sections.length;
  for (let i = 0; i < errorBoundary; i++) {
    const err = sections[i]!.currentError;
    if (err) historyLines.push(`Resolved: ${truncate(err, 100)}`);
  }

  // Completed tasks: any earlier distinct task collapses to "Done: <task>".
  const seenTasks = new Set<string>(latest.task ? [latest.task] : []);
  for (let i = sections.length - 2; i >= 0; i--) {
    const t = sections[i]!.task;
    if (t && !seenTasks.has(t)) {
      seenTasks.add(t);
      historyLines.push(`Done: ${truncate(t, 80)}`);
    }
  }

  // Open question: latest distinct value wins. Superseded ones are dropped
  // silently — never synthesize a fake resolution.
  let openQuestion: string | undefined;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i]!.openQuestion) { openQuestion = sections[i]!.openQuestion; break; }
  }

  // Architecture decisions: keep the latest (up to 2) sections' decisions in
  // full; older ones collapse to their first sentence.
  const decisionEntries = sections.filter(s => s.archDecision);
  let archDecision: string | undefined;
  if (decisionEntries.length > 0) {
    const recent = decisionEntries.slice(-2);
    archDecision = recent.map(s => s.archDecision).join(' ');
    for (const s of decisionEntries.slice(0, -2)) {
      historyLines.push(firstSentence(s.archDecision!));
    }
  }

  // Stack: dedupe across all sections into one canonical list, first-seen order.
  const stackParts: string[] = [];
  const seenStack = new Set<string>();
  for (const s of sections) {
    if (!s.stack) continue;
    for (const part of s.stack.split(/\s*[·,]\s*/)) {
      const p = part.trim();
      if (p && !seenStack.has(p)) { seenStack.add(p); stackParts.push(p); }
    }
  }

  // Agent sessions: flatten oldest→newest, keep only the last 10.
  const agentSessions = sections.flatMap(s => s.agentSessions).slice(-10);

  // Carry forward History lines already recorded by a previous compaction run,
  // then fold in this run's new collapses, deduped (so repeated `snap` calls
  // don't lose earlier collapsed history or duplicate entries).
  const carriedHistory = sections.flatMap(s => s.historyLines);
  const seenHistory = new Set<string>();
  const mergedHistory: string[] = [];
  for (const h of [...carriedHistory, ...historyLines]) {
    if (!seenHistory.has(h)) { seenHistory.add(h); mergedHistory.push(h); }
  }

  // Drop stale history once the oldest contributing section is >7 days old AND
  // nothing currently unresolved (no open error, no open question) references it.
  const oldestTs = sections[0]!.ts;
  const isStale = (now - oldestTs) > SEVEN_DAYS_MS && !currentError && !openQuestion;

  return {
    project: latest.project,
    dateTime: formatDateTime(new Date(now)),
    task: latest.task ?? '',
    stack: stackParts.join(' · '),
    changedFiles: latest.changedFiles,
    archDecision,
    currentError,
    triedAndFailed,
    openQuestion,
    nextAction: latest.nextAction ?? '',
    agentSessions,
    historyLines: isStale ? [] : mergedHistory,
  };
}

// ─── Re-render ────────────────────────────────────────────────────────────────
// Note: **History:** is not in the literal TRD example template — it's added
// here as the home for COLLAPSE-rule one-liners (resolved errors, done tasks,
// collapsed decisions), since the template otherwise has no slot for them and
// "collapse to one line" implies keeping a trace, not deleting it outright.

function renderCompacted(view: CompactedView): string {
  if (!view.project) return '';

  const lines: string[] = [
    `## Groundhog Context — ${view.project} — ${view.dateTime}`,
    '',
    `**Task:** ${view.task}`,
  ];
  if (view.stack) lines.push(`**Stack:** ${view.stack}`);
  if (view.changedFiles) lines.push(`**Changed files:** ${view.changedFiles}`);
  lines.push('');

  if (view.archDecision) lines.push(`**Architecture decision:** ${view.archDecision}`, '');
  if (view.currentError) lines.push(`**Current error:** ${view.currentError}`, '');

  if (view.triedAndFailed.length > 0) {
    lines.push('**Tried and failed:**');
    for (const t of view.triedAndFailed) lines.push(`  - ${t}`);
    lines.push('');
  }
  if (view.openQuestion) lines.push(`**Open question:** ${view.openQuestion}`, '');

  lines.push(`**Next action:** ${view.nextAction}`);

  if (view.historyLines.length > 0) {
    lines.push('', '**History:**');
    for (const h of view.historyLines) lines.push(`  - ${h}`);
  }
  if (view.agentSessions.length > 0) {
    lines.push('', '**Agent sessions:**');
    for (const a of view.agentSessions) lines.push(`  - ${a}`);
  }

  return lines.join('\n') + '\n';
}

// ─── compactFile ──────────────────────────────────────────────────────────────

export function compactFile(projectRoot: string): string {
  const filePath = getFilePath(projectRoot);
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }

  const sections = parseSections(raw);
  const compacted = applyCompactionRules(sections, Date.now());
  const output = renderCompacted(compacted);

  try {
    fs.writeFileSync(filePath, output, 'utf8');
  } catch {
    // Swallow — caller (e.g. groundhog snap) still gets `output` for clipboard
    // use even if persisting the compacted file back to disk fails.
  }

  return output;
}
