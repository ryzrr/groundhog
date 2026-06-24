import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { RunSepItem, SepInfo } from './common.js';
import { DaemonClient } from '../daemon-client.js';

interface Props {
  sep?: SepInfo;
}

export function Resume({ sep }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  type Stage = 'loading' | 'offline' | 'done';
  const [stage, setStage] = useState<Stage>('loading');

  useEffect(() => {
    let cancelled = false;
    const client = new DaemonClient();
    client.send({ cmd: 'resume' })
      .then(() => { if (!cancelled) setStage('done'); })
      .catch(() => { if (!cancelled) setStage('offline'); });
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
          <Text color={color.textDim}>resume</Text>
        </Box>
        {stage === 'loading' && <Text color={color.textFaint}>Resuming capture…</Text>}
        {stage === 'done' && (
          <>
            <Text color={color.greenHi} bold>✓ Capture resumed</Text>
            <Text color={color.textFaint}>.ground.md will update again on the next heartbeat.</Text>
          </>
        )}
        {stage === 'offline' && (
          <Text color={color.red}>Daemon is offline. Run  groundhog init  to start it.</Text>
        )}
        <Box marginTop={1}><Text color={color.textFaint}>q quit</Text></Box>
      </Box>
    </Box>
  );
}
