import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { RunSepItem, SepInfo } from './common.js';
import { runSpawnDaemon } from '../daemon-spawn.js';
// Deep import — see Block.tsx for why this can't be '@groundhog/daemon'.
import { readPid, isProcessAlive } from '@groundhog/daemon/dist/pid.js';

interface Props {
  sep?: SepInfo;
}

export function Unblock({ sep }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  type Stage = 'working' | 'done' | 'already-running' | 'error';
  const [stage, setStage] = useState<Stage>('working');
  const [pid, setPid]     = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // "Reads PID file to verify clean exit before restart" — refuse to
      // double-spawn if something is already alive under the existing PID.
      const existingPid = await readPid();
      if (existingPid && isProcessAlive(existingPid)) {
        if (!cancelled) { setPid(existingPid); setStage('already-running'); }
        return;
      }

      try {
        const newPid = await runSpawnDaemon();
        if (cancelled) return;
        setPid(newPid);
        setStage('done');
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setStage('error');
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
  }, { isActive: isTTY });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Static items={sep ? [{ id: 'sep' }] : []}>
        {({ id }) => sep ? <RunSepItem key={id} sep={sep} /> : null}
      </Static>
      <Box paddingX={2} flexDirection="column">
        <Box gap={2}>
          <Text color={color.amberHi} bold>groundhog</Text>
          <Text color={color.textDim}>unblock</Text>
        </Box>
        {stage === 'working' && <Text color={color.textFaint}>Restarting daemon…</Text>}
        {stage === 'done' && (
          <>
            <Text color={color.greenHi} bold>✓ Daemon restarted (PID {pid})</Text>
            <Text color={color.textFaint}>Capture is live again.</Text>
          </>
        )}
        {stage === 'already-running' && (
          <Text color={color.amber}>Daemon is already running (PID {pid}) — nothing to restart.</Text>
        )}
        {stage === 'error' && (
          <Text color={color.red}>⚠  {error}</Text>
        )}
        <Box marginTop={1}><Text color={color.textFaint}>q quit</Text></Box>
      </Box>
    </Box>
  );
}
