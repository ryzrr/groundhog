import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileEvent, GitEvent, ShellEvent } from '@groundhog/shared';

// ─── Signals + ExtractedFields types ─────────────────────────────────────────

export interface Signals {
  gitEvents:   GitEvent[];
  fileEvents:  FileEvent[];
  shellEvents: ShellEvent[];
  projectPath: string;
  projectName: string;
}

export interface ExtractedFields {
  task:            string;
  taskIsInferred:  boolean; // true = from branch/file heuristic; false = from commit message
  stack:           string;
  projectDesc?:    string;
  arch?:           string;
  changed?:        string;
  recentCommits?:  string;
  error?:          string;
  tried?:          string;
  resolved?:       string;
  open?:           undefined; // V1: always empty
  next:            string;
}

// ─── TASK ─────────────────────────────────────────────────────────────────────

const CONVENTIONAL_PREFIX = /^(?:feat|fix|chore|docs|refactor|test|style|perf|build|ci)(?:\(.+?\))?!?:\s*/i;

function extractTask(signals: Signals, now: number): { task: string; taskIsInferred: boolean } {
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  // 1. Latest commit message < 2h ago
  const recentCommits = signals.gitEvents
    .filter(e => e.type === 'commit' && (now - e.ts) < TWO_HOURS)
    .sort((a, b) => b.ts - a.ts);

  if (recentCommits.length > 0) {
    const msg = (recentCommits[0]!.message ?? '').replace(CONVENTIONAL_PREFIX, '').trim();
    if (msg.length > 4) return { task: msg.slice(0, 80), taskIsInferred: false };
  }

  // 2. Branch name (skip generic branches like main/master/develop)
  const latestGit = [...signals.gitEvents].sort((a, b) => b.ts - a.ts)[0];
  if (latestGit?.branch) {
    const branch = parseBranchName(latestGit.branch);
    if (branch) {
      // 2b. Branch + most-changed file for extra specificity
      const topFile = getMostEditedFile(signals.fileEvents);
      if (topFile) return { task: `${branch} (${topFile})`, taskIsInferred: true };
      return { task: branch, taskIsInferred: true };
    }
  }

  // 3. Most frequently edited file alone
  const topFile = getMostEditedFile(signals.fileEvents);
  if (topFile) return { task: `Working on ${topFile}`, taskIsInferred: true };

  return { task: 'Active development session', taskIsInferred: true };
}

function getMostEditedFile(fileEvents: FileEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const e of fileEvents) counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
  if (counts.size === 0) return null;
  const [topPath] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return path.basename(topPath!, path.extname(topPath!));
}

function parseBranchName(branch: string): string | null {
  // Skip default / generic branches — they convey no task info
  if (/^(?:main|master|develop|dev|trunk|HEAD)$/i.test(branch)) return null;
  const stripped = branch.replace(/^(?:feat|fix|feature|chore|hotfix|refactor|docs)\//i, '');
  if (stripped.length < 3) return null;
  return stripped.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80);
}

// ─── PROJECT DESC ─────────────────────────────────────────────────────────────

function extractProjectDesc(projectPath: string): string | undefined {
  // 1. Root package.json description
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
    if (typeof pkg.description === 'string' && pkg.description.trim().length > 10) {
      return pkg.description.trim().slice(0, 160);
    }
  } catch {}

  // 2. README.md — first non-heading paragraph after the title
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    try {
      const text = fs.readFileSync(path.join(projectPath, name), 'utf8');
      const lines = text.split('\n');
      let pastTitle = false;
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('#')) { pastTitle = true; continue; }
        if (!pastTitle) continue;
        // Skip badges, HTML tags, shield.io lines, empty lines
        if (!t || t.startsWith('!') || t.startsWith('<') || t.startsWith('[!')) continue;
        if (t.length > 20) return t.replace(/[*_`]/g, '').slice(0, 160);
      }
    } catch {}
  }
  return undefined;
}

// ─── ARCH ─────────────────────────────────────────────────────────────────────

function extractArch(projectPath: string): string | undefined {
  const MONO_DIRS = ['apps', 'packages', 'services', 'libs', 'modules'];
  const parts: string[] = [];

  for (const dir of MONO_DIRS) {
    const dirPath = path.join(projectPath, dir);
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .slice(0, 4);

      for (const entry of entries) {
        try {
          const pkg = JSON.parse(
            fs.readFileSync(path.join(dirPath, entry.name, 'package.json'), 'utf8')
          );
          const desc = (pkg.description ?? '').trim();
          // Strip redundant project-name prefix (e.g. "Groundhog CLI — ")
          const cleanDesc = desc.replace(/^groundhog\s*[-–—]?\s*/i, '').slice(0, 55);
          parts.push(cleanDesc ? `${dir}/${entry.name} (${cleanDesc})` : `${dir}/${entry.name}`);
        } catch {
          parts.push(`${dir}/${entry.name}`);
        }
        if (parts.length >= 5) break;
      }
    } catch {}
    if (parts.length >= 5) break;
  }

  // Only emit arch if we found at least 2 packages (i.e. it's actually a monorepo)
  return parts.length >= 2 ? parts.join(' · ') : undefined;
}

// ─── CHANGED ─────────────────────────────────────────────────────────────────

const CHANGED_IGNORE = /(?:node_modules|dist|\.git|\.next|__pycache__|\.cache|\.turbo)\//;

function extractChanged(fileEvents: FileEvent[], projectPath: string, now: number): string | undefined {
  const ONE_HOUR = 60 * 60 * 1000;

  // Deduplicate by relative path, keep most-recent timestamp
  const seen = new Map<string, number>();
  for (const e of fileEvents) {
    if ((now - e.ts) > ONE_HOUR) continue;
    const rel = path.relative(projectPath, e.path).replace(/\\/g, '/');
    if (CHANGED_IGNORE.test(rel)) continue;
    const prev = seen.get(rel) ?? 0;
    if (e.ts > prev) seen.set(rel, e.ts);
  }

  if (seen.size === 0) return undefined;

  // Sort by recency, top 5
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rel]) => rel)
    .join(' · ');
}

// ─── RECENT COMMITS ──────────────────────────────────────────────────────────

function extractRecentCommits(gitEvents: GitEvent[], now: number): string | undefined {
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const msgs = gitEvents
    .filter(e => e.type === 'commit' && e.message && (now - e.ts) < SEVEN_DAYS)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 3)
    .map(e => (e.message ?? '').replace(CONVENTIONAL_PREFIX, '').trim().slice(0, 55))
    .filter(m => m.length > 3);

  return msgs.length > 0 ? msgs.join(' · ') : undefined;
}

// ─── STACK ────────────────────────────────────────────────────────────────────

const DEP_MAP: Record<string, string> = {
  next: 'Next.js', react: 'React', vue: 'Vue', svelte: 'Svelte',
  '@angular/core': 'Angular', nuxt: 'Nuxt',
  express: 'Express', fastify: 'Fastify', koa: 'Koa', hapi: 'hapi',
  '@nestjs/core': 'NestJS', nestjs: 'NestJS',
  '@trpc/server': 'tRPC', trpc: 'tRPC',
  graphql: 'GraphQL', 'apollo-server': 'Apollo', 'apollo-server-express': 'Apollo',
  'socket.io': 'Socket.io',
  '@prisma/client': 'Prisma', prisma: 'Prisma',
  'drizzle-orm': 'Drizzle', typeorm: 'TypeORM', sequelize: 'Sequelize', mongoose: 'Mongoose',
  '@supabase/supabase-js': 'Supabase', firebase: 'Firebase', 'firebase-admin': 'Firebase',
  pg: 'PostgreSQL', mysql2: 'MySQL', redis: 'Redis', 'better-sqlite3': 'SQLite', sqlite3: 'SQLite',
  typescript: 'TypeScript', vite: 'Vite', webpack: 'webpack', esbuild: 'esbuild',
  tailwindcss: 'Tailwind', '@mui/material': 'MUI', 'styled-components': 'styled-components',
  jest: 'Jest', vitest: 'Vitest', mocha: 'Mocha', cypress: 'Cypress', playwright: 'Playwright',
  electron: 'Electron', tauri: 'Tauri',
  axios: 'Axios', 'node-fetch': 'node-fetch',
  chokidar: 'chokidar', 'simple-git': 'simple-git', ink: 'Ink',
};

function extractStack(projectPath: string): string {
  const pkgPath = path.join(projectPath, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const matched = new Set<string>();
    for (const dep of Object.keys(allDeps)) {
      const label = DEP_MAP[dep];
      if (label) matched.add(label);
    }
    if (matched.size > 0) return [...matched].slice(0, 6).join(' · ');
    return 'Node.js';
  } catch {}

  if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    const labels = parsePythonDeps(path.join(projectPath, 'requirements.txt'));
    return labels.length > 0 ? labels.slice(0, 5).join(' · ') : 'Python';
  }
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml'))) return 'Python';

  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    try {
      const mod = fs.readFileSync(path.join(projectPath, 'go.mod'), 'utf8');
      const m = mod.match(/^module\s+(\S+)/m);
      return `Go${m ? ` (${m[1]!.split('/').pop()})` : ''}`;
    } catch { return 'Go'; }
  }

  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) return 'Rust';

  return '';
}

const PYTHON_DEP_MAP: Record<string, string> = {
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI',
  pandas: 'Pandas', numpy: 'NumPy', pytorch: 'PyTorch', tensorflow: 'TensorFlow',
  sqlalchemy: 'SQLAlchemy', pydantic: 'Pydantic', celery: 'Celery',
};

function parsePythonDeps(reqPath: string): string[] {
  try {
    const lines = fs.readFileSync(reqPath, 'utf8').split('\n');
    const matched = new Set<string>();
    for (const line of lines) {
      const dep = line.split(/[=><!\[]/)[0]!.trim().toLowerCase();
      const label = PYTHON_DEP_MAP[dep];
      if (label) matched.add(label);
    }
    return [...matched];
  } catch { return []; }
}

// ─── ERROR ────────────────────────────────────────────────────────────────────

const ERROR_PATTERNS: RegExp[] = [
  /(?:Error|Exception|FAILED|Cannot find|SyntaxError|TypeError|ReferenceError|RangeError)\s*:?\s*(.{10,120})/i,
  /exit\s+(?:code|status)\s+([1-9]\d*)/i,
  /panic:\s+(.{5,100})/i,
  /FATAL\s+(.{5,100})/i,
  /npm\s+ERR!\s+(.{5,100})/i,
  /ModuleNotFoundError:\s*(.{5,100})/i,
  /ImportError:\s*(.{5,100})/i,
  /AttributeError:\s*(.{5,100})/i,
];

function extractError(shellEvents: ShellEvent[], now: number): string | undefined {
  const WINDOW = 30 * 60 * 1000;
  const recent = shellEvents.filter(e => (now - e.ts) < WINDOW);
  for (let i = recent.length - 1; i >= 0; i--) {
    const cmd = recent[i]!.command;
    for (const pattern of ERROR_PATTERNS) {
      const m = cmd.match(pattern);
      if (m) {
        const hit = (m[1] ?? m[0]).trim().slice(0, 120);
        if (hit.length > 5) return hit;
      }
    }
  }
  return undefined;
}

// ─── TRIED ────────────────────────────────────────────────────────────────────

function normalizeCmd(cmd: string): string {
  return cmd
    .replace(/\s+--?[\w-]+=?\S*/g, '')
    .replace(/\s+['"][^'"]+['"]/g, '')
    .replace(/\s+[./~]\S+/g, '')
    .trim();
}

const TRIED_IGNORE = new Set([
  'git status', 'git log', 'git diff', 'git add', 'git stash',
  'node', 'npx', 'pnpm', 'npm', 'yarn',
]);

function extractTried(shellEvents: ShellEvent[], now: number): string | undefined {
  const WINDOW = 30 * 60 * 1000;
  const recent = shellEvents.filter(e => (now - e.ts) < WINDOW).map(e => e.command);

  const counts = new Map<string, number>();
  for (const cmd of recent) {
    const norm = normalizeCmd(cmd);
    if (norm.length < 4 || TRIED_IGNORE.has(norm)) continue;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }

  const repeated = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cmd]) => cmd);

  return repeated.length > 0 ? repeated.join('; ') : undefined;
}

// ─── RESOLVED ────────────────────────────────────────────────────────────────

const RESOLVED_PATTERNS = [
  /^(?:fix|feat|resolve|implement|complete|done|close|closes|fixed)(?:\(.+?\))?!?:\s*(.+)/i,
  /\b(?:resolved?|fixed?|implemented?|completed?)\s+(.{10,80})/i,
];

function extractResolved(gitEvents: GitEvent[], now: number): string | undefined {
  const WINDOW = 4 * 60 * 60 * 1000;
  const recent = gitEvents
    .filter(e => e.type === 'commit' && (now - e.ts) < WINDOW && e.message)
    .sort((a, b) => b.ts - a.ts);

  for (const e of recent) {
    const msg = e.message ?? '';
    for (const pattern of RESOLVED_PATTERNS) {
      const m = msg.match(pattern);
      if (m) return (m[1] ?? msg).trim().slice(0, 80);
    }
  }
  return undefined;
}

// ─── NEXT ────────────────────────────────────────────────────────────────────

function extractNext(task: string, taskIsInferred: boolean, signals: Signals, now: number): string {
  // 1. Branch name that differs from task (means the branch intent is still ahead of current work)
  const latestGit = [...signals.gitEvents].sort((a, b) => b.ts - a.ts)[0];
  if (latestGit?.branch) {
    const parsed = parseBranchName(latestGit.branch);
    if (parsed && parsed.toLowerCase() !== task.toLowerCase()) return parsed;
  }

  // 2. TODO/FIXME comment in the most recently edited code files
  const ONE_HOUR = 60 * 60 * 1000;
  const recentFiles = [...new Set(
    signals.fileEvents
      .filter(e => (now - e.ts) < ONE_HOUR)
      .sort((a, b) => b.ts - a.ts)
      .map(e => e.path)
  )].slice(0, 6);

  for (const filePath of recentFiles) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'].includes(ext)) continue;
      const stat = fs.statSync(filePath);
      if (stat.size > 150_000) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      // Only scan last 80 lines — recent edits at the bottom
      const tail = content.split('\n').slice(-80).join('\n');
      const m = tail.match(/\/\/\s*TODO:?\s+(.{10,80})/i) ??
                tail.match(/#\s*TODO:?\s+(.{10,80})/i);
      if (m) return m[1]!.trim().slice(0, 80);
    } catch {}
  }

  // 3. Fall back — don't copy task verbatim
  return taskIsInferred
    ? `Finish: ${task.slice(0, 60)}`
    : `Continue: ${task.slice(0, 60)}`;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export function extractFields(signals: Signals): ExtractedFields {
  const now = Date.now();
  const { task, taskIsInferred } = extractTask(signals, now);

  return {
    task,
    taskIsInferred,
    stack:          extractStack(signals.projectPath),
    projectDesc:    extractProjectDesc(signals.projectPath),
    arch:           extractArch(signals.projectPath),
    changed:        extractChanged(signals.fileEvents, signals.projectPath, now),
    recentCommits:  extractRecentCommits(signals.gitEvents, now),
    error:          extractError(signals.shellEvents, now),
    tried:          extractTried(signals.shellEvents, now),
    resolved:       extractResolved(signals.gitEvents, now),
    open:           undefined,
    next:           extractNext(task, taskIsInferred, signals, now),
  };
}



