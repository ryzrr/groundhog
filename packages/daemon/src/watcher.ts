import type { FileEvent } from '@groundhog/shared';
import { log } from './log.js';

// Lazy-import chokidar (ESM-only in v5) — imported at runtime so startup is fast
// and so tests can stub it if needed.
type ChokidarWatcher = import('chokidar').FSWatcher;

const IGNORED_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/.turbo/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.DS_Store',
  '**/Thumbs.db',
];

// File extensions that carry meaningful development signal
const WATCHED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.cs', '.cpp', '.c', '.h',
  '.json', '.yaml', '.yml', '.toml', '.env', '.md', '.sql',
  '.html', '.css', '.scss', '.svelte', '.vue',
]);

function isRelevant(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return WATCHED_EXTENSIONS.has(ext);
}

// ─── FileWatcher ─────────────────────────────────────────────────────────────

export class FileWatcher {
  private dirs: Set<string>;
  private ignoredGlobs: string[];
  private debounceMs: number;
  private watcher: ChokidarWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private handler: ((e: FileEvent) => void) | null = null;

  constructor(opts: { dirs: string[]; ignored?: string[]; debounceMs?: number }) {
    this.dirs       = new Set(opts.dirs);
    this.ignoredGlobs = [...IGNORED_GLOBS, ...(opts.ignored ?? [])];
    this.debounceMs = opts.debounceMs ?? 300;
  }

  on(_event: 'file', handler: (e: FileEvent) => void): this {
    this.handler = handler;
    return this;
  }

  async start(): Promise<void> {
    const { watch } = await import('chokidar');
    const dirs = [...this.dirs];

    if (dirs.length === 0) {
      log('warn', 'FileWatcher started with no directories');
      return;
    }

    this.watcher = watch(dirs, {
      ignored:        this.ignoredGlobs,
      persistent:     true,
      ignoreInitial:  true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    for (const evtType of ['add', 'change', 'unlink'] as const) {
      this.watcher.on(evtType, (filePath: string) => {
        if (!isRelevant(filePath)) return;
        this._debounce(filePath, evtType);
      });
    }

    this.watcher.on('error', (err: unknown) => {
      log('error', `FileWatcher error: ${err instanceof Error ? err.message : String(err)}`);
    });

    log('info', `FileWatcher watching ${dirs.length} dirs: ${dirs.slice(0, 3).join(', ')}${dirs.length > 3 ? '…' : ''}`);
  }

  async stop(): Promise<void> {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  addDir(dir: string): void {
    if (this.dirs.has(dir)) return;
    this.dirs.add(dir);
    if (this.watcher) {
      this.watcher.add(dir);
      log('info', `FileWatcher added new dir: ${dir}`);
    }
  }

  private _debounce(filePath: string, type: FileEvent['type']): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const t = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handler?.({ path: filePath, type, ts: Date.now() });
    }, this.debounceMs);

    this.debounceTimers.set(filePath, t);
  }
}
