import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { RunSepItem, SepInfo } from './common.js';
// Deep import on purpose — NOT '@groundhog/daemon' (the package's main entry,
// packages/daemon/src/index.ts, runs the daemon's full startup sequence as a
// module-load side effect; importing it here would start a second daemon).
// pid.ts has no daemon-runtime-only dependencies (just fs/path/os), so this
// subpath import is safe and avoids duplicating PID-file logic in the CLI.
import { readPid, isProcessAlive, clearPid } from '@groundhog/daemon/dist/pid.js';

interface Props {
  sep?: SepInfo;
}

export function Block({ sep }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  type Stage = 'working' | 'done' | 'already-offline';
  const [stage, setStage] = useState<Stage>('working');
  const [killedPid, setKilledPid] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const pid = await readPid();
      if (!pid || !isProcessAlive(pid)) {
        await clearPid();
        if (!cancelled) setStage('already-offline');
        return;
      }

      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 25 && isProcessAlive(pid); i++) {
        await new Promise(r => setTimeout(r, 200)); // poll up to ~5s
      }
      if (isProcessAlive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      await clearPid();

      if (cancelled) return;
      setKilledPid(pid);
      setStage('done');
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
          <Text color={color.textDim}>block</Text>
        </Box>
        {stage === 'working' && <Text color={color.textFaint}>Stopping daemon…</Text>}
        {stage === 'done' && (
          <>
            <Text color={color.greenHi} bold>✓ Daemon stopped (PID {killedPid})</Text>
            <Text color={color.textFaint}>Zero capture, zero network until you run  groundhog unblock</Text>
          </>
        )}
        {stage === 'already-offline' && (
          <Text color={color.amber}>Daemon was not running — nothing to stop.</Text>
        )}
        <Box marginTop={1}><Text color={color.textFaint}>q quit</Text></Box>
      </Box>
    </Box>
  );
}
