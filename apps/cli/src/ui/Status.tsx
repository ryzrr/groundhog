import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { GCBFieldFull, RunSepItem, SepInfo, activityIcon, activityColor, tsAgo } from './common.js';
import { DaemonClient, DaemonOfflineError } from '../daemon-client.js';
import { readFile } from '@groundhog/shared';
import type { GCBSnapshot, DaemonState, ActivityEntry, ProjectInfo } from '@groundhog/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusData {
  state: DaemonState;
  snapshot: GCBSnapshot | null;
  history: GCBSnapshot[];
  activity: ActivityEntry[];
  groundMd: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}


// ─── Static content ───────────────────────────────────────────────────────────

function StatusContent({ data }: { data: StatusData }) {
  const { state, snapshot, history, activity, groundMd } = data;
  const div56 = '─'.repeat(60);
  const snap  = snapshot;

  const statusDot   = state.status === 'watching' ? color.dot.green : color.dot.amber;
  const statusColor = state.status === 'watching' ? color.textDim : color.amber;
  const statusLabel = `${state.status}  ·  daemon PID ${state.pid ?? '—'}`;

  return (
    <Box flexDirection="column" paddingX={2} paddingBottom={1}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Box gap={2} alignItems="center">
        <Text color={color.amberHi} bold>groundhog</Text>
        <Text color={color.textDim}>status</Text>
        <Text color={color.border}>{'─'.repeat(14)}</Text>
        <Text color={statusDot}>●</Text>
        <Text color={statusColor}>{statusLabel}</Text>
      </Box>
      <Text color={color.border}>{div56}</Text>

      {/* ── Active context summary ────────────────────────────────────── */}
      {snap ? (
        <>
          <Box gap={2} alignItems="center">
            <Text color={color.blue} bold>ACTIVE CONTEXT</Text>
            <Text color={color.amberHi} bold>{snap.project}</Text>
            <Text color={color.textFaint}>snapped {timeAgo(snap.createdAt)}  ·</Text>
            <Text color={snap.confidence >= 0.8 ? color.greenHi : color.amber} bold>
              {snap.confidence.toFixed(2)}
            </Text>
            <Text color={color.textFaint}>confidence</Text>
          </Box>
          {snap.projectDesc ? (
            <Text color={color.textFaint}>{snap.projectDesc}</Text>
          ) : (
            <Text color={color.textFaint}>Groundhog has captured your current work session.</Text>
          )}
          <Text color={color.border}>{div56}</Text>

          {snap.arch && (
            <Box gap={2}>
              <Box width={10}><Text color={color.blue} bold>ARCH</Text></Box>
              <Text color={color.textDim}>{snap.arch}</Text>
            </Box>
          )}
          <GCBFieldFull
            label="TASK"
            value={snap.task}
            desc="What you are actively building right now. AI uses this as the session entry point."
            labelColor={color.blue}
          />
          <GCBFieldFull
            label="STACK"
            value={snap.stack}
            desc="The specific tools in play. AI won't suggest incompatible libraries or approaches."
            labelColor={color.blue}
          />
          {snap.changed && (
            <Box gap={2}>
              <Box width={10}><Text color={color.blue} bold>CHANGED</Text></Box>
              <Text color={color.text}>{snap.changed}</Text>
            </Box>
          )}
          {snap.recentCommits && (
            <Box gap={2}>
              <Box width={10}><Text color={color.blue} bold>COMMITS</Text></Box>
              <Text color={color.textDim}>{snap.recentCommits}</Text>
            </Box>
          )}
          <Text color={color.border}>{div56}</Text>

          {snap.resolved && (
            <GCBFieldFull
              label="RESOLVED"
              value={snap.resolved}
              desc="Decisions already made with reasoning. AI won't relitigate them or suggest alternatives."
              labelColor={color.greenHi}
              valueColor={color.greenHi}
            />
          )}
          {snap.error && (
            <GCBFieldFull
              label="ERROR"
              value={snap.error}
              desc="The exact blocker you are hitting. AI can jump straight to root-cause analysis."
              labelColor={color.red}
              valueColor={color.red}
            />
          )}
          {snap.tried && (
            <GCBFieldFull
              label="TRIED"
              value={snap.tried}
              desc="What you have already attempted. AI won't waste your time suggesting dead ends."
              labelColor={color.textDim}
              valueColor={color.textDim}
            />
          )}
          {snap.open && (
            <GCBFieldFull
              label="OPEN"
              value={snap.open}
              desc="Unresolved questions that need AI input. This is what you want the AI to answer."
              labelColor={color.amber}
              valueColor={color.amber}
            />
          )}
          <GCBFieldFull
            label="NEXT"
            value={snap.next}
            desc="The next concrete action after this session. AI can plan ahead without you explaining."
            labelColor={color.blue}
          />

          <Text color={color.border}>{div56}</Text>
          <Box gap={3}>
            <Text color={color.textFaint}>~{snap.tokens} tokens</Text>
            <Text color={snap.confidence >= 0.8 ? color.greenHi : color.amber}>
              confidence {snap.confidence.toFixed(2)}
            </Text>
            <Text color={color.textFaint}>↳ higher = more context captured this session</Text>
          </Box>
        </>
      ) : (
        <>
          <Box gap={2} alignItems="center">
            <Text color={color.blue} bold>ACTIVE CONTEXT</Text>
            <Text color={color.textFaint}>no snapshot yet — daemon is building context</Text>
          </Box>
          <Text color={color.textFaint}>
            Groundhog is watching. Context captures after the first commit or file change.
          </Text>
          <Text color={color.border}>{div56}</Text>
        </>
      )}

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <Box height={1} />
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={color.amberDim}
        paddingX={2}
        paddingY={0}
      >
        <Text color={color.amberHi} bold>PASTE THIS INTO ANY AI TO RESUME INSTANTLY</Text>
        <Text color={color.textDim}>Run  groundhog snap --copy  to copy the context block to clipboard.</Text>
        <Text color={color.textFaint}>Then paste into Claude, Cursor, ChatGPT, or any AI — it picks up right where you left off.</Text>
      </Box>

      {/* ── .ground.md panel ─────────────────────────────────────────── */}
      {groundMd && (
        <>
          <Box height={1} />
          <Box gap={2} alignItems="center">
            <Text color={color.blue} bold>.ground.md</Text>
            <Text color={color.textFaint}>— the file groundhog snap will compact and copy</Text>
          </Box>
          <Text color={color.border}>{'─'.repeat(44)}</Text>
          <Box borderStyle="single" borderColor={color.border} paddingX={1} flexDirection="column">
            {groundMd.split('\n').slice(0, 30).map((line, i) => (
              <Text key={i} color={color.textDim}>{line || ' '}</Text>
            ))}
          </Box>
        </>
      )}

      {/* ── Live capture feed ────────────────────────────────────────── */}
      <Box height={1} />
      <Box gap={2} alignItems="center">
        <Text color={color.blue} bold>LIVE CAPTURE</Text>
        <Text color={color.textFaint}>— raw signals the daemon has seen</Text>
      </Box>
      <Text color={color.border}>{'─'.repeat(44)}</Text>
      {activity.length === 0 ? (
        <Text color={color.textFaint}>  No activity captured yet. Work in a watched directory to see signals here.</Text>
      ) : (
        activity.slice(0, 20).map((e, i) => {
          const icon  = activityIcon(e);
          const clr   = activityColor(e);
          const label = e.label.length > 52 ? '…' + e.label.slice(-51) : e.label;
          return (
            <Box key={i} gap={0}>
              <Box width={5}><Text color={color.textFaint}>{tsAgo(e.ts)}</Text></Box>
              <Box width={5}><Text color={clr}>{icon}</Text></Box>
              <Text color={e.type === 'shell' ? color.textDim : color.text}>{label}</Text>
            </Box>
          );
        })
      )}

      {/* ── Recent snaps ─────────────────────────────────────────────── */}
      {history.length > 0 && (
        <>
          <Box height={1} />
          <Box gap={2} alignItems="center">
            <Text color={color.blue} bold>RECENT SNAPS</Text>
            <Text color={color.textFaint}>— earlier snapshots you can restore with  groundhog sync</Text>
          </Box>
          <Text color={color.border}>{'─'.repeat(44)}</Text>
          {history.map((s, i) => (
            <Box key={i} gap={0}>
              <Box width={14}><Text color={color.text}>{s.project}</Text></Box>
              <Box width={12}><Text color={color.textFaint}>{timeAgo(s.createdAt)}</Text></Box>
              <Text color={s.confidence >= 0.85 ? color.greenHi : color.amber}>
                {s.confidence.toFixed(2)}
              </Text>
              <Text color={color.textFaint}> conf</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}

// ─── Loading / offline states ─────────────────────────────────────────────────

function StatusLoading() {
  return (
    <Box paddingX={2} paddingY={1} flexDirection="column">
      <Box gap={2}>
        <Text color={color.amberHi} bold>groundhog</Text>
        <Text color={color.textDim}>status</Text>
      </Box>
      <Text color={color.textFaint}>Connecting to daemon…</Text>
    </Box>
  );
}

function StatusOffline() {
  return (
    <Box paddingX={2} paddingY={1} flexDirection="column">
      <Box gap={2}>
        <Text color={color.amberHi} bold>groundhog</Text>
        <Text color={color.textDim}>status</Text>
        <Text color={color.border}>{'─'.repeat(14)}</Text>
        <Text color={color.dot.red}>●</Text>
        <Text color={color.red}>offline</Text>
      </Box>
      <Text color={color.border}>{'─'.repeat(60)}</Text>
      <Text color={color.text}>Daemon is not running.</Text>
      <Box gap={1} marginTop={0}>
        <Text color={color.blue}>❯</Text>
        <Text color={color.amberHi} bold>groundhog init</Text>
        <Text color={color.textDim}>to start the daemon and begin capturing context</Text>
      </Box>
    </Box>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  sep?:       SepInfo;
  onSnap?:    () => void;
  onHistory?: () => void;
  onBlock?:   () => void;
}

// ─── Status screen ────────────────────────────────────────────────────────────

export function Status({ sep, onSnap, onHistory, onBlock }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  type LoadState = 'loading' | 'offline' | 'ready';
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [statusData, setStatusData] = useState<StatusData | null>(null);

  const [staticItems] = useState<Array<{ id: string }>>(() => [
    ...(sep ? [{ id: 'sep' }] : []),
    { id: 'content' },
  ]);

  // Fetch daemon data on mount
  useEffect(() => {
    const client = new DaemonClient();
    let cancelled = false;

    async function fetch() {
      try {
        const statusResp = await client.send<{
          ok: true;
          state: DaemonState;
          snapshot: GCBSnapshot | null;
        }>({ cmd: 'status' });

        if (cancelled || !statusResp.ok) return;

        // Fetch recent history for the active project
        const project = statusResp.snapshot?.project
          ?? statusResp.state.projects[0]
          ?? '';

        let history: GCBSnapshot[] = [];
        let activity: ActivityEntry[] = [];
        let groundMd = '';

        if (project) {
          try {
            const histResp = await client.send<{ ok: true; snapshots: GCBSnapshot[] }>(
              { cmd: 'history', project, limit: 10 }
            );
            if (histResp.ok) history = histResp.snapshots;
          } catch {}

          try {
            const actResp = await client.send<{ ok: true; entries: ActivityEntry[] }>(
              { cmd: 'activity', project, limit: 30 }
            );
            if (actResp.ok) activity = actResp.entries;
          } catch {}

          try {
            const projResp = await client.send<{ ok: true; projects: ProjectInfo[] }>(
              { cmd: 'projects' }
            );
            const info = projResp.ok ? projResp.projects.find(p => p.name === project) : undefined;
            if (info) groundMd = readFile(info.path);
          } catch {}
        }

        if (cancelled) return;
        setStatusData({ state: statusResp.state, snapshot: statusResp.snapshot, history, activity, groundMd });
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DaemonOfflineError) {
          setLoadState('offline');
        } else {
          setLoadState('offline');
        }
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) { exit(); return; }
    if (input === 's') { onSnap?.();    return; }
    if (input === 'h') { onHistory?.(); return; }
    if (input === 'b') { onBlock?.();   return; }
    if (key.return)    { onSnap?.();    return; }
  }, { isActive: isTTY });

  if (loadState === 'loading') {
    return (
      <Box flexDirection="column">
        <Static items={sep ? [{ id: 'sep' }] : []}>
          {({ id }) => sep ? <RunSepItem key={id} sep={sep} /> : null}
        </Static>
        <StatusLoading />
      </Box>
    );
  }

  if (loadState === 'offline') {
    return (
      <Box flexDirection="column">
        <Static items={sep ? [{ id: 'sep' }] : []}>
          {({ id }) => sep ? <RunSepItem key={id} sep={sep} /> : null}
        </Static>
        <StatusOffline />
      </Box>
    );
  }

  return (
    <>
      <Static items={staticItems}>
        {({ id }) => {
          if (id === 'sep' && sep) return <RunSepItem key="sep" sep={sep} />;
          return <StatusContent key={id} data={statusData!} />;
        }}
      </Static>

      {/* ── Live: footer ──────────────────────────────────────────────── */}
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text color={color.textFaint}>Quick actions — press a key, or enter to snap:</Text>
        <Text color={color.border}>{'─'.repeat(52)}</Text>
        <Box gap={3}>
          <Box gap={1}><Text color={color.amberHi} bold>s</Text><Text color={color.textDim}>snap</Text></Box>
          <Box gap={1}><Text color={color.amberHi} bold>h</Text><Text color={color.textDim}>history</Text></Box>
          <Box gap={1}><Text color={color.amberHi} bold>b</Text><Text color={color.textDim}>block</Text></Box>
          <Text color={color.textFaint}>q quit</Text>
        </Box>
      </Box>
    </>
  );
}


