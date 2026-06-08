import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const LOG_PATH = path.join(os.homedir(), '.groundhog', 'daemon.log');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] ${msg}\n`;
  try {
    try {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size > MAX_BYTES) {
        // Rotate: rename to .1, start fresh
        try { fs.renameSync(LOG_PATH, LOG_PATH + '.1'); } catch {}
      }
    } catch {}
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch {}
}


