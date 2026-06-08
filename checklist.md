# Groundhog — Implementation Checklist

Every item marked **[ ]** is currently stubbed, hardcoded, or missing.
Ordered by the 8-week build plan in the PRD.

---

## Phase 1 — Daemon + Local Snapshot (Wk 1)

The entire product runs on the daemon. Nothing else is real until this exists.

### 1.1 Daemon core (`packages/daemon`)
- [x] Chokidar filesystem watch — watch dirs, debounce events, detect file create/modify/delete
- [x] simple-git hooks — capture commit messages and branch switch events via git poller (5s poll)
- [x] Terminal command capture — shell history file polling (PowerShell + zsh/bash/fish), redacts secrets
- [x] Privacy enforcement — git diffs and file contents are NEVER stored, only paths and metadata
- [x] Context assembly — combine fs events + git events + terminal events into a structured snapshot object matching `GCBSnapshot`
- [x] Confidence scoring — algorithm that rates 0–1 based on recency, event volume, and field coverage; uses `taskIsInferred` flag (not fragile string matching)
- [x] better-sqlite3 storage — AES-256-GCM per-row encryption; dual backend (better-sqlite3 → sql.js WASM fallback for Windows)
- [x] IPC channel — Unix socket (macOS/Linux) / named pipe (Windows) so CLI can query daemon state

### 1.2 Daemon process management
- [x] PID file — write to `~/.groundhog/daemon.pid` on start, remove on exit
- [x] Start/stop/restart helpers — used by `init`, `block`, `unblock`, `pause`, `resume`
- [ ] Auto-restart on crash (via a simple keep-alive wrapper or PM2-style logic)

### 1.3 CLI: `groundhog init` — wire to real data
- [x] Real project detection — finds git root + non-git dirs; detects stack from `package.json`, etc.; 30-day recency filter skips stale repos
- [x] Real git hook install — writes `post-commit` hook in `.git/hooks/`, handles conflict with existing hook
- [x] Real daemon spawn — starts daemon process detached, polls PID file (200ms, 15s timeout)
- [x] Real first snapshot — calls daemon IPC snap after 1.5s settle; stores real `GCBSnapshot` in SQLite
- [x] Remove all hardcoded fake timings from `Init.tsx` — all phases use real async operations

### 1.4 CLI: `groundhog status` — wire to real data
- [x] IPC call to daemon — fetch current `DaemonState` (pid, status, projects)
- [x] Read latest `GCBSnapshot` from SQLite for the active project
- [x] Render real GCB fields (TASK, STACK, RESOLVED, ERROR, TRIED, OPEN, NEXT)
- [x] Show real confidence score and token count
- [x] Show real recent snaps list from SQLite (project, time ago, confidence)
- [x] Handle `status: 'offline'` — daemon not running, show instructions to run `groundhog init`
- [x] LIVE CAPTURE feed — shows real-time file changes, shell commands, git events from daemon ring buffers

---

## Phase 2 — Thread Bridge / GCB Format (Wk 2)

### 2.1 CLI: `groundhog snap` — wire to real data
- [x] Read real `GCBSnapshot` from daemon IPC / SQLite
- [x] GCB text generation — `formatGCB()` in `packages/shared` serializes snapshot into canonical format
- [x] Token counting — char/4 + 40 overhead estimate
- [x] `--copy` flag — real clipboard write using `clipboardy`
- [x] `--inject cursor` — writes GCB to `.cursorrules` in the detected project root
- [x] `--inject claude` — formats as XML block, copies to clipboard
- [x] `--inject file` — writes to `.groundhog-context.md` in project root
- [x] Remove all hardcoded GCB content from `Snap.tsx`

### 2.2 GCB compression via Anthropic API (optional enhancement, still Wk 2)
- [ ] Call Claude API to compress verbose session notes into structured GCB fields
- [ ] Target < 200 tokens output
- [ ] Graceful fallback if no API key — use raw snapshot fields directly

---

## Phase 3 — CLI Polish + npm Publish (Wk 3)

### 3.1 CLI: `groundhog pause`
Currently: `PlaceholderScreen`.
- [ ] Build real Pause screen — confirm pause, show Burrow sleeping state
- [ ] IPC call to daemon — pause event capture (daemon stays alive, just stops writing)
- [ ] Update daemon status to `'paused'`

### 3.2 CLI: `groundhog resume`
Currently: command not implemented.
- [ ] Add `resume` subcommand to Commander.js
- [ ] IPC call to daemon — resume event capture
- [ ] Update daemon status to `'watching'`

### 3.3 CLI: `groundhog block`
Currently: `PlaceholderScreen`.
- [ ] Build real Block screen — show block confirmation + timestamp
- [ ] Actually kill daemon process via `process.kill(pid, 'SIGTERM')`
- [ ] Remove PID file after kill
- [ ] Print signed terminal output with timestamp (block guarantee from PRD §7.2)
- [ ] `--until HH:MM` — schedule auto-unblock at given time

### 3.4 CLI: `groundhog unblock`
Currently: command not implemented.
- [ ] Add `unblock` subcommand
- [ ] Spawn daemon process, write new PID file
- [ ] Show Burrow emerging from underground

### 3.5 CLI: `groundhog history`
Currently: `PlaceholderScreen`.
- [ ] Build full History TUI screen — vertical timeline of snapshots
- [ ] Read all snapshots from SQLite for current project
- [ ] Each row: project name, timestamp, one-line task summary, confidence score
- [ ] Expand row on Enter to show full snapshot
- [ ] Query filter — if `groundhog history "<query>"` is passed, filter/highlight matching rows
- [ ] Navigation: arrow keys to move, Enter to expand, q to quit

### 3.6 CLI: `groundhog sync`
Currently: `PlaceholderScreen`.
- [ ] Build real Sync screen — reads latest snapshot from SQLite and offers injection
- [ ] `--project <name>` flag — switch active project then restore
- [ ] Show GCB block and prompt user to pick inject target (same tabs as Snap screen)

### 3.7 CLI: `groundhog project list`
Currently: not implemented.
- [ ] Add `project list` subcommand
- [ ] Read tracked projects from SQLite, display with last-active time

### 3.8 CLI: `groundhog project switch <name>`
Currently: not implemented.
- [ ] Add `project switch <name>` subcommand
- [ ] Write active project to config file (`~/.groundhog/config.json`)
- [ ] Daemon picks up new active project on next IPC poll

### 3.9 CLI: `groundhog audit`
Currently: not implemented.
- [ ] Add `audit` subcommand
- [ ] Read raw event log from SQLite (last 24h)
- [ ] Display in plain language: "14:02 — committed on branch feat/auth", "14:15 — modified src/index.ts", etc.

### 3.10 CLI: `groundhog config`
Currently: not implemented.
- [ ] Add `config` subcommand
- [ ] Write default config to `~/.groundhog/config.json` if not present
- [ ] Open in `$EDITOR` (or `notepad` on Windows)

### 3.11 npm publish readiness
- [ ] `groundhog` binary properly registered in `package.json` `bin` field
- [ ] Clean README with demo GIF
- [ ] `.npmignore` or `files` field to exclude `src/`, `node_modules/`, etc.
- [ ] v0.1.0 published to npm

---

## Phase 4 — Supabase Cloud Sync (Wk 4)

- [ ] Supabase project + table schema for encrypted snapshots
- [ ] AES-256-GCM encryption — key derived from GitHub token via PBKDF2, never leaves client
- [ ] `groundhog sync` — upload latest snapshot to Supabase (encrypted ciphertext only)
- [ ] `groundhog sync` (restore) — pull latest encrypted snapshot, decrypt locally
- [ ] Multi-device: `groundhog sync --project <name>` from a different machine restores that project's context
- [ ] Config: Supabase URL + encryption key management in `groundhog config`
- [ ] Sync status shown in `groundhog status` footer

---

## Phase 5 — Tray App (Wk 5)

### 5.1 Desktop app: connect to real daemon data
Currently: all data in `apps/desktop/app/page.tsx` is hardcoded (project name, "watching" badge, 87% confidence, etc.).
- [ ] IPC bridge from Electron main process to daemon Unix socket
- [ ] Show real project name from active project config
- [ ] Show real daemon status (`watching` / `paused` / `blocked` / `offline`) as badge
- [ ] Show real branch name from simple-git
- [ ] Show real current task from latest `GCBSnapshot`
- [ ] Show real confidence score on progress bar

### 5.2 Desktop app: real tray actions
Currently: all buttons are static, no onClick handlers wired to real operations.
- [ ] "Snap & Copy" button — IPC to daemon → generate GCB → clipboard write
- [ ] "Pause" button — IPC to daemon → pause capture → update badge
- [ ] "History" button — open history view (or open CLI in terminal)
- [ ] "Open App" button — open full desktop window

### 5.3 Burrow tray sprite animation states
Currently: Electron tray uses a static icon.
- [ ] Implement all 7 animation states from PRD §4.1 (watching, snapping, syncing, paused, blocked, restoring, error)
- [ ] Drive tray icon from daemon status via IPC

---

## Phase 6 — VS Code Extension + Full Desktop App (Wk 6)

### 6.1 VS Code extension (`packages/vscode` — does not exist yet)
- [ ] Scaffold `packages/vscode` with `vsce` toolchain
- [ ] Status bar item — shows current project + daemon status
- [ ] Command palette entry: "Groundhog: Snap & Copy"
- [ ] Report active file + time-on-file to daemon (optional, off by default per PRD)
- [ ] Cursor inject: write to `.cursorrules` from within VS Code

### 6.2 Desktop app full screens (Tauri migration or Electron)
- [ ] Home screen — real context dashboard, one-click Snap button, live Burrow animation
- [ ] Thread Bridge screen — paste chat export → compress → show GCB → one-click copy
- [ ] History screen — vertical timeline, semantic search bar
- [ ] Projects screen — project switcher sidebar, health indicators
- [ ] Settings screen — all config groups from PRD §5.1 (monitoring, privacy, sync, Burrow, inject targets, plugins)

---

## Phase 7 — Open Source Launch (Wk 7)

- [ ] `CONTRIBUTING.md` with setup guide, commit conventions, and plugin API overview
- [ ] Issue templates (bug report, feature request, good-first-issue)
- [ ] Label existing stubs as `good-first-issue` on GitHub
- [ ] `groundhog uninstall` command — remove SQLite, config, git hooks, tray app cleanly
- [ ] `groundhog update` command — self-update via `npm install -g groundhog@latest`
- [ ] Demo GIF in README
- [ ] HN Show HN post draft

---

## Phase 8 — Plugin API + Community (Wk 8+)

- [ ] Connector interface spec — typed `GroundhogConnector` interface in `packages/shared`
- [ ] Reference connector: Obsidian (reads `.md` vault files, extracts task/context signals)
- [ ] `groundhog-skin-*` npm package format spec for community Burrow skins
- [ ] Plugin registry in `groundhog config` — install/enable/disable connectors

---

## Summary — What Is Real vs Stub Right Now

| Area | Status |
|---|---|
| CLI screen router + screen UI | Real (Ink TUI renders correctly) |
| Burrow mascot + Splash animation | Real (pixel art rendering) |
| Electron tray window mechanics | Real (shows/hides on click) |
| Daemon — filesystem watch | **REAL** — chokidar watching all registered projects |
| Daemon — git signal capture | **REAL** — simple-git polling every 5s |
| Daemon — shell command capture | **REAL** — history file polling, secrets redacted |
| Daemon — context assembly | **REAL** — assembler.ts fuses signals into GCBSnapshot |
| Daemon — encrypted storage | **REAL** — AES-256-GCM per row, better-sqlite3 + sql.js fallback |
| Daemon — IPC server | **REAL** — named pipe (Windows) / Unix socket |
| Daemon — PID management | **REAL** — ~/.groundhog/daemon.pid |
| Daemon — dynamic project discovery | **REAL** — detects `cd` in shell, registers git + non-git dirs |
| Init wizard phases | **REAL** — real detection, hook install, daemon spawn, first snap |
| Status screen data | **REAL** — live from daemon IPC (project, PID, GCB fields, confidence) |
| Status — LIVE CAPTURE feed | **REAL** — shows file changes, shell commands, git events |
| Snap screen data | **REAL** — live GCB from daemon; --copy/--inject all work |
| History screen | **STUB** — `PlaceholderScreen` |
| Sync screen | **STUB** — `PlaceholderScreen` |
| Pause screen | **STUB** — `PlaceholderScreen` |
| Block screen | **STUB** — `PlaceholderScreen` |
| Desktop tray data | **FAKE** — hardcoded project, confidence, branch |
| Desktop tray actions | **FAKE** — buttons do nothing |
| Auto-restart on crash | **MISSING** |
| Claude API GCB compression | **MISSING** |
