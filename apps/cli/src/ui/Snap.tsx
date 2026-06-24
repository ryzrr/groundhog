import { useState, useEffect, useContext, useRef } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { SPIN_FRAMES, RunSepItem, SepInfo } from './common.js';
import { DaemonClient } from '../daemon-client.js';
import { compactFile } from '@groundhog/shared';
import type { ProjectInfo } from '@groundhog/shared';

// ─── Static content pieces ────────────────────────────────────────────────────

function SnapHeader() {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box gap={1}>
        <Text color={color.amberHi} bold>groundhog</Text>
        <Text color={color.textDim}>snap</Text>
      </Box>
      <Box>
        <Text color={color.textFaint}>
          Compacting .ground.md to its current essential state and copying it to your clipboard.
        </Text>
      </Box>
      <Text color={color.border}>{'─'.repeat(60)}</Text>
    </Box>
  );
}

function SnapResult({ project, compacted }: { project: string; compacted: string }) {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box gap={2}>
        <Text color={color.greenHi} bold>✓</Text>
        <Text color={color.text} bold>.ground.md compacted</Text>
        <Text color={color.greenHi} bold>{project}</Text>
      </Box>
      <Box paddingLeft={0}>
        <Text color={color.textFaint}>
          Copied to clipboard — paste into Claude, Cursor, ChatGPT, or any AI to resume instantly.
        </Text>
      </Box>
      <Box height={1} />
      <Box flexDirection="column" borderStyle="single" borderColor={color.blueDim} paddingX={1}>
        {compacted.split('\n').map((line, i) => (
          <Text key={i} color={color.text}>{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  );
}

function SnapOffline() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={color.red}>Daemon is offline. Run  groundhog init  to start it.</Text>
    </Box>
  );
}

function SnapEmpty() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={color.amber}>No .ground.md yet for this project — Groundhog is still building context.</Text>
    </Box>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  sep?: SepInfo;
}

// ─── Snap screen ─────────────────────────────────────────────────────────────

export function Snap({ sep }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  // Local animation timer — scoped to this screen only (root App carries no tick).
  const [tick, setTick] = useState(0);

  type Stage = 'loading' | 'offline' | 'empty' | 'ready';
  const [stage,      setStage]      = useState<Stage>('loading');
  const [project,    setProject]    = useState('');
  const [compacted,  setCompacted]  = useState('');

  const [staticItems, setStaticItems] = useState<Array<{ id: string }>>(() => [
    ...(sep ? [{ id: 'sep' }] : []),
    { id: 'header' },
  ]);
  const pushedStatic = useRef<Set<string>>(new Set());
  function pushOnce(id: string) {
    if (pushedStatic.current.has(id)) return;
    pushedStatic.current.add(id);
    setStaticItems(prev => [...prev, { id }]);
  }

  useEffect(() => {
    if (!isTTY || stage !== 'loading') return;
    const id = setInterval(() => setTick(t => t + 1), 120);
    return () => clearInterval(id);
  }, [isTTY, stage]);

  // Resolve active project, trigger a fresh snapshot, then compact .ground.md.
  useEffect(() => {
    const client = new DaemonClient();
    let cancelled = false;

    async function run() {
      try {
        const statusResp = await client.send<{
          ok: true;
          state: { projects: string[] };
          snapshot: { project: string } | null;
        }>({ cmd: 'status' });

        if (cancelled || !statusResp.ok) return;

        const projectName = statusResp.snapshot?.project
          ?? statusResp.state.projects[0]
          ?? '';

        if (!projectName) {
          setStage('empty');
          pushOnce('empty');
          return;
        }

        // Trigger a fresh assembly so .ground.md has the latest section before compacting.
        await client.send({ cmd: 'snap', project: projectName }).catch(() => null);

        const projectsResp = await client.send<{ ok: true; projects: ProjectInfo[] }>(
          { cmd: 'projects' }
        );
        if (cancelled || !projectsResp.ok) return;

        const info = projectsResp.projects.find(p => p.name === projectName);
        if (!info) {
          setStage('empty');
          pushOnce('empty');
          return;
        }

        const text = compactFile(info.path);
        if (cancelled) return;

        if (!text) {
          setStage('empty');
          pushOnce('empty');
          return;
        }

        const { default: clipboardy } = await import('clipboardy');
        clipboardy.writeSync(text);

        setProject(projectName);
        setCompacted(text);
        setStage('ready');
        pushOnce('result');
      } catch {
        if (cancelled) return;
        setStage('offline');
        pushOnce('offline');
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
  }, { isActive: isTTY });

  const spinner = SPIN_FRAMES[tick % SPIN_FRAMES.length]!;

  return (
    <>
      <Static items={staticItems}>
        {({ id }) => {
          if (id === 'sep' && sep) return <RunSepItem key="sep" sep={sep} />;
          if (id === 'header')     return <SnapHeader key="header" />;
          if (id === 'result')     return <SnapResult key="result" project={project} compacted={compacted} />;
          if (id === 'offline')    return <SnapOffline key="offline" />;
          if (id === 'empty')      return <SnapEmpty key="empty" />;
          return null;
        }}
      </Static>

      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        {stage === 'loading' ? (
          <Box gap={1}>
            <Text color={color.amber}>{spinner}</Text>
            <Text color={color.amberHi}>Compacting .ground.md…</Text>
          </Box>
        ) : (
          <Text color={color.textFaint}>q quit</Text>
        )}
      </Box>
    </>
  );
}
