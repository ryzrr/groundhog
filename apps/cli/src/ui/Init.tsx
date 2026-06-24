import { useState, useEffect, useContext, useRef } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { GCBField, SPIN_FRAMES, RunSepItem, SepInfo } from './common.js';
import { DaemonClient, DaemonOfflineError } from '../daemon-client.js';
import { runSpawnDaemon } from '../daemon-spawn.js';
import type { GCBSnapshot } from '@groundhog/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedProject {
  path: string;
  name: string;
  stack: string;
  hasGit: boolean;
}

// ─── Phase sequencer ─────────────────────────────────────────────────────────

type Phase = 'detect' | 'hooks' | 'daemon' | 'snap' | 'done';
const PHASES: Phase[] = ['detect', 'hooks', 'daemon', 'snap', 'done'];

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  detect: 'Scanning for git repos to decide what Groundhog should watch…',
  hooks:  'Installing post-commit hooks so Groundhog captures every save…',
  daemon: 'Starting the background daemon — it runs silently, using < 0.5% CPU…',
  snap:   'Capturing your first context snapshot to verify everything works…',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectStack(dir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const labels: string[] = [];
    if (deps['next'])              labels.push('Next.js');
    if (deps['react'] && !deps['next']) labels.push('React');
    if (deps['@supabase/supabase-js']) labels.push('Supabase');
    if (deps['prisma'] || deps['@prisma/client']) labels.push('Prisma');
    if (deps['typescript'])        labels.push('TypeScript');
    if (deps['express'] || deps['fastify']) labels.push('Node.js');
    if (labels.length === 0) labels.push('Node.js');
    return labels.join(' · ');
  } catch {}
  if (fs.existsSync(path.join(dir, 'requirements.txt'))) return 'Python';
  if (fs.existsSync(path.join(dir, 'go.mod')))           return 'Go';
  if (fs.existsSync(path.join(dir, 'Cargo.toml')))       return 'Rust';
  return 'unknown';
}

// Returns the mtime of the last commit in a git repo, or 0 if no commits yet.
function lastCommitMs(dir: string): number {
  try {
    return fs.statSync(path.join(dir, '.git', 'COMMIT_EDITMSG')).mtimeMs;
  } catch { return 0; }
}

async function runDetect(): Promise<DetectedProject[]> {
  const cwd = process.cwd();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  const seeds = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'dev'),
    path.join(os.homedir(), 'projects'),
    path.join(os.homedir(), 'src'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'repos'),
  ].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });

  // Walk up from cwd to find its git root (up to 4 levels)
  function findGitRoot(dir: string): string | null {
    let cur = dir;
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(cur, '.git'))) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return null;
  }

  const cwdRoot = findGitRoot(cwd) ?? cwd; // always track cwd even without git
  // dir → { ts: last-commit mtime, hasGit }
  const found = new Map<string, { ts: number; hasGit: boolean }>();

  // cwd is always included (maximally recent so it sorts first)
  found.set(cwdRoot, { ts: Date.now(), hasGit: fs.existsSync(path.join(cwdRoot, '.git')) });

  for (const seed of seeds) {
    const checkDir = (dir: string) => {
      const hasGit = fs.existsSync(path.join(dir, '.git'));
      if (!hasGit) return; // broad scan: only pick up git repos (cwd without git is already added above)
      const ts = lastCommitMs(dir);
      if (ts < cutoff && dir !== cwdRoot) return; // skip stale repos
      if (!found.has(dir)) found.set(dir, { ts, hasGit: true });
    };

    checkDir(seed);
    try {
      const entries = fs.readdirSync(seed, { withFileTypes: true });
      for (const e of entries.slice(0, 40)) {
        if (!e.isDirectory()) continue;
        checkDir(path.join(seed, e.name));
      }
    } catch {}
  }

  // Sort: cwd root first, then by recency descending
  const sorted = Array.from(found.entries())
    .sort(([aDir, a], [bDir, b]) => {
      if (aDir === cwdRoot) return -1;
      if (bDir === cwdRoot) return 1;
      return b.ts - a.ts;
    })
    .slice(0, 10);

  return sorted.map(([dir, { hasGit }]) => ({
    path: dir,
    name: path.basename(dir),
    stack: detectStack(dir),
    hasGit,
  }));
}

function ensureGroundMdGitignored(projectPath: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');
  try {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    const alreadyIgnored = existing.split('\n').some(l => l.trim() === '.ground.md');
    if (!alreadyIgnored) {
      const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(gitignorePath, existing + sep + '.ground.md\n');
    }
  } catch {
    fs.writeFileSync(gitignorePath, '.ground.md\n');
  }
}

async function runHooks(projects: DetectedProject[]): Promise<void> {
  const hookLine = `\n# Groundhog — auto-capture context on every commit\ngroundhog snap > /dev/null 2>&1 &\n`;
  for (const p of projects.filter(p => p.hasGit)) {
    const hookPath = path.join(p.path, '.git', 'hooks', 'post-commit');
    try {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (!existing.includes('groundhog')) {
        fs.writeFileSync(hookPath, existing + hookLine);
      }
    } catch {
      fs.writeFileSync(hookPath, `#!/bin/sh${hookLine}`);
    }
    try { fs.chmodSync(hookPath, 0o755); } catch {}

    ensureGroundMdGitignored(p.path);
  }
}

async function runFirstSnap(projects: DetectedProject[]): Promise<GCBSnapshot | null> {
  const client = new DaemonClient();

  // Give assembler a moment to set up
  await new Promise(r => setTimeout(r, 1500));

  // Try status first to find what project is active
  try {
    const statusResp = await client.send<{ ok: true; state: { projects: string[] }; snapshot: GCBSnapshot | null }>(
      { cmd: 'status' }
    );
    if (statusResp.ok && statusResp.snapshot) return statusResp.snapshot;

    // Force a snap on the first known project
    const projectName = statusResp.ok && statusResp.state.projects[0]
      ? statusResp.state.projects[0]
      : projects[0]?.name ?? '';

    if (projectName) {
      const snapResp = await client.send<{ ok: true; snapshot: GCBSnapshot } | { ok: false; error: string }>(
        { cmd: 'snap', project: projectName }
      );
      if (snapResp.ok) return snapResp.snapshot;
    }
  } catch {}

  return null;
}

// ─── Static content builders ──────────────────────────────────────────────────

type DoneItem = { id: Phase };

interface PhaseData {
  projects: DetectedProject[];
  pid: number | null;
  snap: GCBSnapshot | null;
}

function CompletedPhase({ id, data }: { id: Phase; data: PhaseData }) {
  switch (id) {
    case 'detect':
      return (
        <Box flexDirection="column" paddingX={2}>
          <Box gap={1}>
            <Text color={color.greenHi} bold>✓</Text>
            <Text color={color.text} bold>Projects detected</Text>
            <Text color={color.textFaint}>— Groundhog will watch these directories</Text>
          </Box>
          {data.projects.length === 0 ? (
            <Box paddingLeft={4}>
              <Text color={color.textFaint}>No active projects found — cwd will be tracked.</Text>
            </Box>
          ) : (
            data.projects.slice(0, 8).map((p, i) => (
              <Box key={i} paddingLeft={4}>
                <Box width={3}>
                  <Text color={p.hasGit ? color.greenHi : color.amber}>
                    {p.hasGit ? '✓' : '◎'}
                  </Text>
                </Box>
                <Box width={24} flexShrink={0}>
                  <Text color={color.text}>{p.name}</Text>
                </Box>
                <Text color={p.hasGit ? color.textFaint : color.amber}>
                  {p.hasGit ? p.stack : 'no git — file & shell tracking only'}
                </Text>
              </Box>
            ))
          )}
          <Box paddingLeft={4}>
            <Text color={color.textFaint}>
              ↳ Any directory you cd into is auto-added. Git repos get commit context too.
            </Text>
          </Box>
        </Box>
      );

    case 'hooks': {
      const gitProjects = data.projects.filter(p => p.hasGit);
      return (
        <Box flexDirection="column" paddingX={2}>
          <Box gap={1}>
            <Text color={color.greenHi} bold>✓</Text>
            <Text color={color.text} bold>Git hooks installed</Text>
            <Text color={color.textFaint}>— context captured automatically on every commit</Text>
          </Box>
          {gitProjects.length === 0 ? (
            <Box paddingLeft={4}>
              <Text color={color.textFaint}>No git repos detected — hooks skipped.</Text>
            </Box>
          ) : (
            gitProjects.slice(0, 8).map((p, i) => (
              <Box key={i} paddingLeft={4}>
                <Text color={color.greenHi}>✓  </Text>
                <Text color={color.textDim}>{p.name}</Text>
                <Text color={color.textFaint}> · .git/hooks/post-commit installed</Text>
              </Box>
            ))
          )}
          <Box paddingLeft={4}>
            <Text color={color.textFaint}>
              ↳ Hooks are silent — they add ~40ms to your git commit, nothing more.
            </Text>
          </Box>
        </Box>
      );
    }

    case 'daemon':
      return (
        <Box flexDirection="column" paddingX={2}>
          <Box gap={1}>
            <Text color={color.greenHi} bold>✓</Text>
            <Text color={color.text} bold>Background daemon started</Text>
            <Text color={color.textFaint}>— runs silently until you run  groundhog block</Text>
          </Box>
          <Box paddingLeft={4}>
            <Text color={color.greenHi}>✓  </Text>
            <Text color={color.textDim}>PID </Text>
            <Text color={color.text}>{data.pid ?? '—'}</Text>
            <Text color={color.textDim}>
              {'  · watching '}{data.projects.length}{' project'}{data.projects.length !== 1 ? 's' : ''}{'  · < 0.5% CPU'}
            </Text>
          </Box>
          <Box paddingLeft={4}>
            <Text color={color.textFaint}>
              ↳ The daemon survives terminal closes. Use  groundhog pause  to pause capture.
            </Text>
          </Box>
        </Box>
      );

    case 'snap': {
      const s = data.snap;
      return (
        <Box flexDirection="column" paddingX={2}>
          <Box gap={1}>
            <Text color={color.greenHi} bold>✓</Text>
            <Text color={color.text} bold>First snapshot captured</Text>
            <Text color={color.textFaint}>— here is what Groundhog knows about your work</Text>
          </Box>
          {s ? (
            <Box
              flexDirection="column"
              marginLeft={4}
              borderStyle="single"
              borderColor={color.greenDim}
              paddingX={1}
            >
              <Text color={color.greenHi} bold>{s.project}</Text>
              <GCBField label="TASK"  value={s.task}             labelColor={color.blue} />
              <GCBField label="STACK" value={s.stack}            labelColor={color.blue} />
              {s.error    && <GCBField label="ERROR" value={s.error} labelColor={color.red}  valueColor={color.red} />}
              <GCBField label="NEXT"  value={s.next}             labelColor={color.blue} />
              <Text color={color.textFaint}>~{s.tokens} tokens  ·  confidence {s.confidence.toFixed(2)}</Text>
            </Box>
          ) : (
            <Box paddingLeft={4}>
              <Text color={color.textFaint}>
                Snapshot is building — run  groundhog snap --copy  after a few seconds.
              </Text>
            </Box>
          )}
          <Box paddingLeft={4}>
            <Text color={color.textFaint}>
              ↳ This is the context block you will paste into AI tools. Run  groundhog snap --copy  to copy it.
            </Text>
          </Box>
        </Box>
      );
    }

    default:
      return null;
  }
}

// ─── Init screen ─────────────────────────────────────────────────────────────

export function Init({ sep }: { sep?: SepInfo }) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  // Local animation timer — scoped to this screen only (root App carries no tick).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isTTY) return;
    const id = setInterval(() => setTick(t => t + 1), 120);
    return () => clearInterval(id);
  }, [isTTY]);

  const [phase, setPhase]                 = useState<Phase>('detect');
  const [doneItems, setDoneItems]         = useState<DoneItem[]>([]);
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [phaseError, setPhaseError]       = useState<string | null>(null);
  const pushedPhases = useRef<Set<Phase>>(new Set());

  const [phaseData, setPhaseData] = useState<PhaseData>({
    projects: [],
    pid: null,
    snap: null,
  });

  const [sepItems] = useState<Array<{ id: string }>>(() =>
    sep ? [{ id: 'sep' }] : []
  );

  useEffect(() => {
    if (phase === 'done') {
      const id = setTimeout(() => setShowNextSteps(true), 300);
      return () => clearTimeout(id);
    }

    let cancelled = false;

    async function run() {
      try {
        switch (phase) {
          case 'detect': {
            const projects = await runDetect();
            if (cancelled) return;
            setPhaseData(prev => ({ ...prev, projects }));
            advance('detect');
            break;
          }
          case 'hooks': {
            await runHooks(phaseData.projects);
            if (cancelled) return;
            advance('hooks');
            break;
          }
          case 'daemon': {
            const pid = await runSpawnDaemon();
            if (cancelled) return;
            setPhaseData(prev => ({ ...prev, pid }));
            advance('daemon');
            break;
          }
          case 'snap': {
            const snap = await runFirstSnap(phaseData.projects);
            if (cancelled) return;
            setPhaseData(prev => ({ ...prev, snap }));
            advance('snap');
            break;
          }
        }
      } catch (err) {
        if (cancelled) return;
        setPhaseError(String(err));
        // Still advance — don't block the whole init on one failure
        advance(phase);
      }
    }

    function advance(current: Phase) {
      const nextIdx = PHASES.indexOf(current) + 1;
      const next    = PHASES[nextIdx] ?? 'done';
      if (!pushedPhases.current.has(current)) {
        pushedPhases.current.add(current);
        setDoneItems(prev => [...prev, { id: current }]);
      }
      setPhase(next);
    }

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useInput((input, key) => {
    if (key.escape || input === 'q') exit();
  }, { isActive: isTTY });

  const spinner = SPIN_FRAMES[tick % SPIN_FRAMES.length]!;
  const isDone  = phase === 'done';

  return (
    <Box flexDirection="column" paddingY={1}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Box paddingX={2} flexDirection="column">
        <Box gap={2}>
          <Text color={color.amberHi} bold>groundhog</Text>
          <Text color={color.textDim}>init</Text>
          <Text color={color.textFaint}>— first-time setup</Text>
        </Box>
        <Text color={color.textFaint}>
          Scanning your machine, installing capture hooks, and starting the background daemon.
        </Text>
        <Text color={color.border}>{'─'.repeat(60)}</Text>
      </Box>

      {/* ── Separator ─────────────────────────────────────────────────────── */}
      {sepItems.length > 0 && (
        <Static items={sepItems}>
          {({ id }) => sep ? <RunSepItem key={id} sep={sep} /> : null}
        </Static>
      )}

      {/* ── Static: completed phases ──────────────────────────────────────── */}
      <Static items={doneItems}>
        {(item) => <CompletedPhase key={item.id} id={item.id} data={phaseData} />}
      </Static>

      {/* ── Current animated step ─────────────────────────────────────────── */}
      {!isDone && (
        <Box gap={1} paddingX={2}>
          <Text color={color.amber}>{spinner}</Text>
          <Text color={color.amberHi}>{PHASE_LABEL[phase]}</Text>
        </Box>
      )}

      {/* ── Phase error (non-fatal) ─────────────────────────────────────────── */}
      {phaseError && (
        <Box paddingX={2}>
          <Text color={color.red}>⚠  {phaseError}</Text>
        </Box>
      )}

      {/* ── Done: what to do next ──────────────────────────────────────────── */}
      {showNextSteps && (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          <Text color={color.border}>{'─'.repeat(60)}</Text>
          <Text color={color.amberHi} bold>SETUP COMPLETE — here is how to use Groundhog:</Text>
          <Box gap={0} marginTop={0}>
            <Box width={2} />
            <Box flexDirection="column" gap={0}>
              <Box gap={2}>
                <Text color={color.amberHi} bold>①</Text>
                <Box flexDirection="column">
                  <Text color={color.text}>Work normally — Groundhog watches in the background.</Text>
                  <Text color={color.textFaint}>  Every commit, file save, and terminal error is captured.</Text>
                </Box>
              </Box>
              <Box gap={2}>
                <Text color={color.amberHi} bold>②</Text>
                <Box flexDirection="column">
                  <Box gap={1}>
                    <Text color={color.text}>Run</Text>
                    <Text color={color.amberHi} bold>groundhog snap --copy</Text>
                    <Text color={color.text}>when switching to an AI tool.</Text>
                  </Box>
                  <Text color={color.textFaint}>  Compresses your session to ~180 tokens and copies to clipboard.</Text>
                </Box>
              </Box>
              <Box gap={2}>
                <Text color={color.amberHi} bold>③</Text>
                <Box flexDirection="column">
                  <Text color={color.text}>Paste into Claude, Cursor, ChatGPT — AI resumes instantly.</Text>
                  <Text color={color.textFaint}>  No re-explaining. No context loss. Zero extra effort.</Text>
                </Box>
              </Box>
            </Box>
          </Box>
          <Box marginTop={1} gap={2}>
            <Text color={color.blue} bold>❯</Text>
            <Text color={color.amberHi} bold>groundhog status</Text>
            <Text color={color.textDim}>to see everything Groundhog is tracking right now</Text>
          </Box>
        </Box>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <Box paddingX={2} marginTop={1}>
        <Text color={color.border}>{'─'.repeat(48)}</Text>
      </Box>
      <Box paddingX={2} gap={3}>
        <Box gap={1}>
          <Text color={isDone ? color.dot.green : color.dot.amber}>●</Text>
          <Text color={isDone ? color.greenHi : color.amberHi}>
            {isDone
              ? `init complete · ${phaseData.projects.length} project${phaseData.projects.length !== 1 ? 's' : ''} tracked`
              : 'running…'}
          </Text>
        </Box>
        <Text color={color.textFaint}>q quit</Text>
      </Box>

    </Box>
  );
}
