import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { GCBSnapshot } from '@groundhog/shared';
import { log } from './log.js';

const _require = createRequire(import.meta.url);

// ─── Database adapter interface ───────────────────────────────────────────────
// Abstracts over better-sqlite3 (sync, native) and sql.js (sync after init, WASM).

interface DbAdapter {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  getOne<T>(sql: string, params?: unknown[]): T | undefined;
  getAll<T>(sql: string, params?: unknown[]): T[];
  close(): void;
}

// ─── better-sqlite3 adapter ───────────────────────────────────────────────────

class BetterSqliteAdapter implements DbAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }
  exec(sql: string): void { this.db.exec(sql); }
  run(sql: string, params: unknown[] = []): void { this.db.prepare(sql).run(...params); }
  getOne<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  getAll<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  close(): void { try { this.db.close(); } catch {} }
}

// ─── sql.js adapter ───────────────────────────────────────────────────────────

class SqlJsAdapter implements DbAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any, private dbPath: string) {}

  exec(sql: string): void {
    this.db.exec(sql);
    this._persist();
  }

  run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as unknown[]);
    this._persist();
  }

  getOne<T>(sql: string, params: unknown[] = []): T | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt: any = this.db.prepare(sql, params as unknown[]);
    try {
      if (!stmt.step()) return undefined;
      return this._normalizeRow(stmt.getAsObject()) as T;
    } finally { stmt.free(); }
  }

  getAll<T>(sql: string, params: unknown[] = []): T[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt: any = this.db.prepare(sql, params as unknown[]);
    const rows: T[] = [];
    try {
      while (stmt.step()) rows.push(this._normalizeRow(stmt.getAsObject()) as T);
    } finally { stmt.free(); }
    return rows;
  }

  close(): void {
    try { this._persist(); this.db.close(); } catch {}
  }

  _persist(): void {
    try {
      const data: Uint8Array = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      log('error', `sql.js persist failed: ${String(err)}`);
    }
  }

  // sql.js returns Uint8Array for BLOBs — convert to Buffer for consistent downstream handling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _normalizeRow(row: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v instanceof Uint8Array ? Buffer.from(v) : v;
    }
    return out;
  }
}

// ─── Factory: try better-sqlite3, fall back to sql.js ────────────────────────

async function createAdapter(dbPath: string): Promise<DbAdapter> {
  // Try better-sqlite3 first (native, fastest)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BetterSqlite3: any = _require('better-sqlite3');
    const db = new BetterSqlite3(dbPath);
    log('info', 'Storage backend: better-sqlite3 (native)');
    return new BetterSqliteAdapter(db);
  } catch {
    log('warn', 'better-sqlite3 native build unavailable — using sql.js (WASM) fallback');
    process.stderr.write('[groundhog] Using sql.js fallback (better-sqlite3 not compiled)\n');
  }

  // Fall back to sql.js (pure WASM, no native build required)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initSqlJs: (opts?: Record<string, unknown>) => Promise<any> = _require('sql.js');
  const SQL = await initSqlJs();

  // Load existing DB from disk if present, otherwise create fresh
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  try {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } catch {
    db = new SQL.Database();
  }
  log('info', 'Storage backend: sql.js (WASM)');
  return new SqlJsAdapter(db, dbPath);
}

// ─── Encrypted payload shape ───────────────────────────────────────────────────
// Everything on GCBSnapshot except the three identity fields stored as plaintext
// columns (id, project, createdAt). Typed (not an inline object literal) so that
// adding a field to GCBSnapshot causes a compile error here if this isn't updated,
// instead of silently dropping data at runtime.
type SnapshotPayload = Omit<GCBSnapshot, 'id' | 'project' | 'createdAt'>;

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface SnapshotRow {
  id: string;
  project: string;
  created_at: number;
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
}

// ─── Storage class ────────────────────────────────────────────────────────────

export class Storage {
  private adapter!: DbAdapter;
  private key: Buffer;
  private dbPath: string;

  private constructor(dbPath: string, key: Buffer) {
    this.dbPath = dbPath;
    this.key    = key;
  }

  // Static async factory — must be used instead of constructor
  static async create(dbPath: string, key: Buffer): Promise<Storage> {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storage  = new Storage(dbPath, key);
    storage.adapter = await createAdapter(dbPath);
    storage._init();
    return storage;
  }

  private _init(): void {
    this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id         TEXT PRIMARY KEY,
        project    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        iv         BLOB NOT NULL,
        auth_tag   BLOB NOT NULL,
        ciphertext BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(project, created_at DESC);

      CREATE TABLE IF NOT EXISTS daemon_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    log('info', 'Storage schema ready');
  }

  // ─── Snapshot writes ──────────────────────────────────────────────────────

  saveSnapshot(snap: Omit<GCBSnapshot, 'id'>): GCBSnapshot {
    const id = crypto.randomUUID();
    const payload: SnapshotPayload = {
      tokens:         snap.tokens,
      confidence:     snap.confidence,
      projectDesc:    snap.projectDesc,
      arch:           snap.arch,
      task:           snap.task,
      stack:          snap.stack,
      changed:        snap.changed,
      recentCommits:  snap.recentCommits,
      resolved:       snap.resolved,
      error:          snap.error,
      tried:          snap.tried,
      open:           snap.open,
      next:           snap.next,
    };
    const payloadJson = JSON.stringify(payload);

    const iv      = crypto.randomBytes(12);
    const cipher  = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct      = Buffer.concat([cipher.update(payloadJson, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    this.adapter.run(
      'INSERT INTO snapshots (id, project, created_at, iv, auth_tag, ciphertext) VALUES (?,?,?,?,?,?)',
      [id, snap.project, snap.createdAt.getTime(), iv, authTag, ct]
    );

    log('info', `Saved snapshot for ${snap.project} (conf=${snap.confidence.toFixed(2)}, ~${snap.tokens}tok)`);
    return { id, project: snap.project, createdAt: snap.createdAt, ...this._decryptPayload({ id, iv, auth_tag: authTag, ciphertext: ct } as SnapshotRow)! };
  }

  // ─── Snapshot reads ───────────────────────────────────────────────────────

  getLatestSnapshot(project: string): GCBSnapshot | null {
    const row = this.adapter.getOne<SnapshotRow>(
      'SELECT * FROM snapshots WHERE project = ? ORDER BY created_at DESC LIMIT 1',
      [project]
    );
    return row ? this._rowToSnapshot(row) : null;
  }

  getSnapshots(project: string, limit: number): GCBSnapshot[] {
    const rows = this.adapter.getAll<SnapshotRow>(
      'SELECT * FROM snapshots WHERE project = ? ORDER BY created_at DESC LIMIT ?',
      [project, limit]
    );
    return rows.map(r => this._rowToSnapshot(r)).filter((s): s is GCBSnapshot => s !== null);
  }

  getAllProjects(): string[] {
    const rows = this.adapter.getAll<{ project: string }>(
      'SELECT DISTINCT project FROM snapshots'
    );
    return rows.map(r => r.project);
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  getConfig(key: string): string | null {
    const row = this.adapter.getOne<{ value: string }>(
      'SELECT value FROM daemon_config WHERE key = ?', [key]
    );
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.adapter.run(
      'INSERT OR REPLACE INTO daemon_config (key, value) VALUES (?,?)', [key, value]
    );
  }

  close(): void { this.adapter.close(); }

  // ─── Crypto ───────────────────────────────────────────────────────────────

  private _rowToSnapshot(row: SnapshotRow): GCBSnapshot | null {
    const payload = this._decryptPayload(row);
    if (!payload) return null;
    return { id: row.id, project: row.project, createdAt: new Date(row.created_at), ...payload };
  }

  private _decryptPayload(row: Pick<SnapshotRow, 'id' | 'iv' | 'auth_tag' | 'ciphertext'>):
    SnapshotPayload | null
  {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv));
      decipher.setAuthTag(Buffer.from(row.auth_tag));
      const plain = decipher.update(Buffer.from(row.ciphertext)).toString('utf8') + decipher.final('utf8');
      // JSON.parse returns `any` — cast is not runtime-validated; old rows saved before this
      // fix simply lack the newer fields, which JSON.parse leaves undefined (same as today's
      // optional-field behavior).
      return JSON.parse(plain) as SnapshotPayload;
    } catch (err) {
      log('error', `Decrypt failed for snapshot ${row.id}: ${String(err)}`);
      return null;
    }
  }
}
