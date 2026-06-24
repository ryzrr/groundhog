import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { RunSepItem, SepInfo, activityIcon, activityColor, tsAgo } from './common.js';
import { DaemonClient } from '../daemon-client.js';
import type { ActivityEntry } from '@groundhog/shared';

interface Props {
  sep?: SepInfo;
  query?: string;
}

type LoadState = 'loading' | 'offline' | 'ready';

export function History({ sep, query }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [project, setProject]     = useState('');
  const [entries,  setEntries]    = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const client = new DaemonClient();

    async function run() {
      try {
        const statusResp = await client.send<{
          ok: true; state: { projects: string[] }; snapshot: { project: string } | null;
        }>({ cmd: 'status' });
        if (cancelled || !statusResp.ok) return;

        const projectName = statusResp.snapshot?.project ?? statusResp.state.projects[0] ?? '';
        setProject(projectName);

        let result: ActivityEntry[] = [];
        if (projectName) {
          const actResp = await client.send<{ ok: true; entries: ActivityEntry[] }>(
            { cmd: 'activity', project: projectName, limit: 100 }
          );
          if (actResp.ok) result = actResp.entries;
        }
        if (cancelled) return;
        setEntries(result);
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('offline');
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
  }, { isActive: isTTY });

  // No semantic search backend exists today — a simple client-side substring
  // filter over the label is a cheap, honest interim behavior for `--query`.
  const filtered = query
    ? entries.filter(e => e.label.toLowerCase().includes(query.toLowerCase()))
    : entries;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Static items={sep ? [{ id: 'sep' }] : []}>
        {({ id }) => sep ? <RunSepItem key={id} sep={sep} /> : null}
      </Static>

      <Box paddingX={2} flexDirection="column">
        <Box gap={2}>
          <Text color={color.amberHi} bold>groundhog</Text>
          <Text color={color.textDim}>history</Text>
          {project && <Text color={color.textFaint}>— {project}</Text>}
          {query && <Text color={color.textFaint}>· filter: "{query}"</Text>}
        </Box>
        <Text color={color.border}>{'─'.repeat(60)}</Text>

        {loadState === 'loading' && <Text color={color.textFaint}>Loading activity…</Text>}
        {loadState === 'offline' && (
          <Text color={color.red}>Daemon is offline. Run  groundhog init  to start it.</Text>
        )}
        {loadState === 'ready' && filtered.length === 0 && (
          <Text color={color.textFaint}>
            {query ? 'No activity matches that filter.' : 'No activity captured yet.'}
          </Text>
        )}
        {loadState === 'ready' && filtered.map((e, i) => {
          const icon = activityIcon(e);
          const clr  = activityColor(e);
          const label = e.label.length > 70 ? '…' + e.label.slice(-69) : e.label;
          return (
            <Box key={i} gap={0}>
              <Box width={5}><Text color={color.textFaint}>{tsAgo(e.ts)}</Text></Box>
              <Box width={5}><Text color={clr}>{icon}</Text></Box>
              <Text color={e.type === 'shell' ? color.textDim : color.text}>{label}</Text>
            </Box>
          );
        })}

        <Box marginTop={1}><Text color={color.textFaint}>q quit</Text></Box>
      </Box>
    </Box>
  );
}
