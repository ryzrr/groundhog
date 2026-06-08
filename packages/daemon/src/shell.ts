import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ShellEvent } from '@groundhog/shared';
import { redact } from './redactor.js';
import { log } from './log.js';

// Commands that produce zero useful signal
const NOISE_COMMANDS = new Set(['ls', 'dir', 'pwd', 'clear', 'cls', 'history', 'man', 'help']);

// Regex to detect cd/navigation commands and extract the target path
const CD_PATTERN = /^(?:cd|Set-Location|sl|pushd)\s+(.+)/i;

// ─── Per-file state ───────────────────────────────────────────────────────────

interface FileState {
  lastSize: number;
  lastOffset: number;
  format: 'powershell' | 'zsh' | 'bash' | 'fish' | 'plain';
}

// ─── History file detection ───────────────────────────────────────────────────

function detectHistoryFiles(): string[] {
  const files: string[] = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    // PowerShell PSReadLine history
    const psHistory = path.join(
      process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'
    );
    files.push(psHistory);
    // Also check $PSREADLINE_HISTORY_SAVE_PATH if set
    const envPath = process.env['PSREADLINE_HISTORY_SAVE_PATH'];
    if (envPath && !files.includes(envPath)) files.push(envPath);
  } else {
    // Use $HISTFILE if set
    const envHist = process.env['HISTFILE'];
    if (envHist) files.push(envHist);
    // Common locations
    const candidates = [
      [path.join(home, '.zsh_history'),  'zsh'],
      [path.join(home, '.bash_history'), 'bash'],
      [path.join(home, '.local', 'share', 'fish', 'fish_history'), 'fish'],
    ];
    for (const [f] of candidates) files.push(f as string);
  }

  return files;
}

function detectFormat(filePath: string): FileState['format'] {
  const base = path.basename(filePath).toLowerCase();
  if (base.includes('psreadline') || base === 'consolehost_history.txt') return 'powershell';
  if (base.includes('zsh'))  return 'zsh';
  if (base.includes('fish')) return 'fish';
  if (base.includes('bash')) return 'bash';
  return 'plain';
}

// Warn if zsh history is not configured for incremental writes
function checkZshIncremental(filePath: string): void {
  if (!filePath.includes('zsh')) return;
  const zshrc = path.join(os.homedir(), '.zshrc');
  try {
    const content = fs.readFileSync(zshrc, 'utf8');
    if (!content.includes('INC_APPEND_HISTORY') && !content.includes('SHARE_HISTORY')) {
      log('warn',
        '[groundhog] Live zsh capture disabled — zsh buffers history until session end. ' +
        "Add 'setopt INC_APPEND_HISTORY' to ~/.zshrc for real-time shell tracking."
      );
      process.stderr.write(
        '[groundhog] Live zsh capture requires: setopt INC_APPEND_HISTORY in ~/.zshrc\n'
      );
    }
  } catch {}
}

// ─── Line parsers ─────────────────────────────────────────────────────────────

function parseLines(chunk: string, format: FileState['format']): string[] {
  const lines = chunk.split('\n').map(l => l.trimEnd()).filter(Boolean);
  const cmds: string[] = [];

  if (format === 'powershell' || format === 'plain') {
    cmds.push(...lines);
  } else if (format === 'bash') {
    // Bash HISTTIMEFORMAT: `#<unix_timestamp>` lines precede the command
    for (const line of lines) {
      if (/^#\d{10,}$/.test(line)) continue; // timestamp line — skip
      cmds.push(line);
    }
  } else if (format === 'zsh') {
    // Zsh extended history: `: <timestamp>:<elapsed>;<command>`
    for (const line of lines) {
      const m = line.match(/^:\s*\d+:\d+;(.+)/);
      if (m) {
        cmds.push(m[1]!);
      } else if (!line.startsWith(':')) {
        cmds.push(line); // plain zsh history (setopt no extended_history)
      }
    }
  } else if (format === 'fish') {
    // Fish history YAML-ish: `- cmd: <command>`
    for (const line of lines) {
      const m = line.match(/^-\s*cmd:\s*(.+)/);
      if (m) cmds.push(m[1]!);
    }
  }

  return cmds.filter(c => c.trim().length > 0);
}

// ─── ShellHistoryPoller ───────────────────────────────────────────────────────

export class ShellHistoryPoller {
  private fileStates = new Map<string, FileState>();
  private timer: NodeJS.Timeout | null = null;
  private eventHandler: ((e: ShellEvent) => void) | null = null;
  private cdHandler: ((dir: string) => void) | null = null;

  constructor() {
    const files = detectHistoryFiles();
    for (const f of files) {
      checkZshIncremental(f);
      this.fileStates.set(f, { lastSize: 0, lastOffset: 0, format: detectFormat(f) });
    }
    // Seed initial sizes so we don't replay the entire history on startup
    for (const [f, state] of this.fileStates) {
      try {
        const stat = fs.statSync(f);
        state.lastSize   = stat.size;
        state.lastOffset = stat.size;
      } catch {}
    }
    log('info', `Shell history poller watching: ${[...this.fileStates.keys()].join(', ')}`);
  }

  start(intervalMs: number, handler: (e: ShellEvent) => void): void {
    this.eventHandler = handler;
    this.timer = setInterval(() => this._tick(), intervalMs);
    this._tick(); // immediate first tick
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  onCdCommand(handler: (dir: string) => void): void {
    this.cdHandler = handler;
  }

  getHistoryFiles(): string[] {
    return [...this.fileStates.keys()];
  }

  private _tick(): void {
    for (const [filePath, state] of this.fileStates) {
      this._pollFile(filePath, state);
    }
  }

  private _pollFile(filePath: string, state: FileState): void {
    try {
      const stat = fs.statSync(filePath);
      const currentSize = stat.size;

      if (currentSize === state.lastSize) return; // no new content

      if (currentSize < state.lastSize) {
        // File truncated or rotated — reset
        state.lastOffset = 0;
      }
      state.lastSize = currentSize;

      const bytesToRead = currentSize - state.lastOffset;
      if (bytesToRead <= 0) return;

      // Read only new bytes
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, state.lastOffset);
      fs.closeSync(fd);
      state.lastOffset += bytesRead;

      const chunk = buf.slice(0, bytesRead).toString('utf8');
      const commands = parseLines(chunk, state.format);

      const now = Date.now();
      for (const rawCmd of commands) {
        const cmd = redact(rawCmd.trim());
        if (!cmd) continue;

        const baseCmd = cmd.split(/\s+/)[0]?.toLowerCase() ?? '';
        if (NOISE_COMMANDS.has(baseCmd)) continue;

        // Emit general shell event
        this.eventHandler?.({ command: cmd, ts: now });

        // Detect cd commands for dynamic project discovery
        const cdMatch = cmd.match(CD_PATTERN);
        if (cdMatch && this.cdHandler) {
          const rawDir = cdMatch[1]!.trim().replace(/^['"]|['"]$/g, '');
          // Resolve ~ and relative paths conservatively
          const resolved = rawDir.startsWith('~')
            ? path.join(os.homedir(), rawDir.slice(1))
            : path.isAbsolute(rawDir) ? rawDir : null;
          if (resolved) this.cdHandler(resolved);
        }
      }
    } catch {
      // File may not exist yet — normal on first run
    }
  }
}
