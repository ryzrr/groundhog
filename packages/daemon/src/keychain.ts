import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const KEY_PATH = path.join(os.homedir(), '.groundhog', '.key');

// Loads the 32-byte AES-256-GCM encryption key, generating and persisting it on first call.
// Idempotent — safe if two processes race on first init (worst case: second write wins, both get valid key).
export async function loadKey(): Promise<Buffer> {
  const dir = path.dirname(KEY_PATH);
  await fs.promises.mkdir(dir, { recursive: true });

  try {
    const key = await fs.promises.readFile(KEY_PATH);
    if (key.length === 32) return key;
    // Wrong length — regenerate
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  const key = crypto.randomBytes(32);
  await fs.promises.writeFile(KEY_PATH, key);
  // Best-effort chmod — silently ignored on Windows (NTFS ACLs protect it by default)
  try { await fs.promises.chmod(KEY_PATH, 0o600); } catch {}
  return key;
}
