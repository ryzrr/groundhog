import React, { useContext, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { TTYContext } from '../index.js';
import { color } from './theme.js';

// ─── ASCII logo ───────────────────────────────────────────────────────────────

const LOGO = [
  "  ██████╗ ██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗ ██╗  ██╗██████╗  ██████╗ ",
  " ██╔════╝ ██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗██║  ██║██╔══██╗██╔════╝ ",
  " ██║  ███╗██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║███████║██║  ██║██║  ███╗",
  " ██║   ██║██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║██╔══██║██║  ██║██║   ██║",
  " ╚██████╔╝██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝██║  ██║██████╔╝╚██████╔╝",
  "  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ",
];

const LOGO_COLORS = [
  color.amberHi,
  color.amberHi,
  color.amber,
  color.amber,
  color.amberDim,
  color.amberFaint,
];

// ─── Groundhog pop-up animation ───────────────────────────────────────────────

const GH_FRAMES = [
  [
    "                                                                          ",
    "                                                                          ",
    " ._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,._.,.",
  ],
  [
    "                                                                          ",
    "                                    _ _                                   ",
    " ._.,._.,._.,._.,._.,._.,._.,._.,._(o o)._.,._.,._.,._.,._.,._.,._.,._.,..",
  ],
  [
    "                                    _ _                                   ",
    "                                   (o o)                                  ",
    " ._.,._.,._.,._.,._.,._.,._.,._.,._(\" \")._.,._.,._.,._.,._.,._.,._.,._.,..",
  ],
  [
    "                                    _ _                                   ",
    "                                   (o. )                                  ",
    " ._.,._.,._.,._.,._.,._.,._.,._.,._(\" \")._.,._.,._.,._.,._.,._.,._.,._.,..",
  ],
  [
    "                                    _ _                                   ",
    "                                   ( .o)                                  ",
    " ._.,._.,._.,._.,._.,._.,._.,._.,._(\" \")._.,._.,._.,._.,._.,._.,._.,._.,..",
  ],
];

const GH_ANIM_MAP = [0, 1, 2, 3, 4, 2, 1, 0, 0, 0];

function buildLine(width: number, items: Array<{ pos: number; str: string }>): string {
  let row = ' '.repeat(width);
  for (const { pos, str } of items) {
    if (pos >= 0 && pos + str.length <= width) {
      row = row.slice(0, pos) + str + row.slice(pos + str.length);
    }
  }
  return row;
}

function generateScene(tick: number): [string, string, string] {
  const W = 74;
  const row0 = buildLine(W, [
    { pos: (10 + Math.floor(tick * 0.8)) % W,                      str: tick % 3 === 0 ? '*' : '.' },
    { pos: Math.max(0, W - 20 - (Math.floor(tick * 0.4) % W)),     str: tick % 4 === 0 ? "'" : ' ' },
  ]);
  const row1 = buildLine(W, [
    { pos: Math.max(0, W - 5  - (Math.floor(tick * 1.2) % W)),     str: tick % 2 === 0 ? '.' : ' ' },
    { pos: (25 + Math.floor(tick * 0.5)) % W,                      str: tick % 3 === 0 ? '*' : ' ' },
  ]);
  const loopTick = Math.floor(tick / 1.5) % GH_ANIM_MAP.length;
  const frame    = GH_FRAMES[GH_ANIM_MAP[loopTick] ?? 0]!;
  const merged0  = frame[0]!.split('').map((c, i) => row0[i] && row0[i] !== ' ' ? row0[i]! : c).join('');
  const merged1  = frame[1]!.split('').map((c, i) => row1[i] && row1[i] !== ' ' ? row1[i]! : c).join('');
  return [merged0, merged1, frame[2]!];
}

// ─── Component ────────────────────────────────────────────────────────────────
// Owns its own animation timer (scoped to this screen only) — the root App no
// longer carries a global tick, so only the screen actually animating re-renders.
// onDone fires exactly once via a one-shot setTimeout.

export function Splash({ onDone }: { onDone: () => void }) {
  const isTTY = useContext(TTYContext);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isTTY) return;
    const id = setInterval(() => setTick(t => t + 1), 120);
    return () => clearInterval(id);
  }, [isTTY]);

  useEffect(() => {
    const id = setTimeout(onDone, 2200);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [s0, s1, s2] = generateScene(tick);

  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      <Box flexDirection="column" alignItems="center">
        {LOGO.map((line, i) => (
          <Text key={i} color={LOGO_COLORS[i % LOGO_COLORS.length]} bold>
            {line}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" alignItems="center">
        <Text color={color.blue}>{s0}</Text>
        <Text color={color.amberHi}>{s1}</Text>
        <Text color={color.blue}>{s2}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={color.textDim}>Loading context engine…</Text>
      </Box>
    </Box>
  );
}
