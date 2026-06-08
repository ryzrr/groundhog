import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Emotion = 'idle' | 'typing' | 'thinking' | 'happy' | 'error';

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG = '#1a1a1a';
const P: Record<string, string> = {
  O: BG,
  K: '#3d1f04',
  M: '#d97706',
  D: '#78350f',
  L: '#fde68a',
  P: '#f472b6',
  E: '#0f0a05',
  W: '#ffffff',
  N: '#fbcfe8',
  T: '#ffffff',
};

function pc(ch: string) { return P[ch] ?? BG; }

// ─── Pixel grid (28 cols × 28 rows) ─────────────────────────────────────────

const BASE = [
  "OOOOOOOOOOOOOOOOOOOOOOOOOOOO",
  "OOOOOOOOOKKKOOOOKKKOOOOOOOOO",
  "OOOOOOOKKPPPKKKKPPPKKOOOOOOO",
  "OOOOOOKPPPPPPKKPPPPPPKOOOOOO",
  "OOOOOOKPPPPPPKPPPPPPPKOOOOOO",
  "OOOOOOKKPPPPKKKPPPPPKKOOOOOO",
  "OOOOOOKKPPPKMMMKPPPPKKOOOOOO",
  "OOOOOKKMMMMMMMMMMMMMMKKOOOOO",
  "OOOOKKMMMMMMMMMMMMMMMMKKOOOO",
  "OOOKKMMMMMMMMMMMMMMMMMMKKOOO",
  "OOOKMMMMMMMMMMMMMMMMMMMMKOOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMMMMMMMMMMMMMMMMMKOO",
  "OOKMMMMMMLLLLLLLLLLMMMMMMKOO",
  "OOKKMMMMLLLLLLLLLLLLMMMMKKOO",
  "OOKKMMMLLLLLLLLLLLLLLMMMKKOO",
  "OOKKMMMLLLLLLLLLLLLLLMMMKKOO",
  "OOOKDMMLLLLLLLLLLLLLLMMDKOOO",
  "OOOKKDMMLLLLLLLLLLLLMMDKKOOO",
  "OOOOKKDDMMLLLLLLLLMMDDKKOOOO",
  "OOOOOKKKDDDDDDDDDDDDKKKOOOOO",
  "OOOOOOSSKKKKKKKKKKKKSSOOOOOO",
  "OOOOOSSSSSSSSSSSSSSSSSSOOOOO",
];

// ─── Overlays ────────────────────────────────────────────────────────────────

const FACES: Record<string, string[]> = {
  idle: [
    "  EWEEE      EWEEE  ",
    "P EEEEW      EEEEW P",
    "PP EEEEE    EEEEE PP",
    "PP  EEE      EEE  PP",
    " P        N        P",
    "         KTK        ",
    "         KKK        ",
    "                    ",
  ],
  blink: [
    "                    ",
    "P                  P",
    "PP  KKK      KKK  PP",
    "PP                PP",
    " P        N        P",
    "         KTK        ",
    "         KKK        ",
    "                    ",
  ],
  typing: [
    "  EWEEE      EWEEE  ",
    "P EEEEW      EEEEW P",
    "PP EEEEE    EEEEE PP",
    "PP  EEE      EEE  PP",
    " P        N        P",
    "         KTK        ",
    "         KKK        ",
    "                    ",
  ],
  thinking: [
    "  EEEWE      EEEWE  ",
    "P WEEEE      WEEEE P",
    "PPEEEEE    EEEEE  PP",
    "PP  EEE      EEE  PP",
    " P        N        P",
    "         KMMK       ",
    "         KKKK       ",
    "                    ",
  ],
  happy: [
    "   EE          EE   ",
    "P E  E        E  E P",
    "PPE  EE      EE  EEPP",
    "PP                PP",
    " P        N        P",
    "         KTTTK      ",
    "          KKK       ",
    "                    ",
  ],
  error: [
    "  E   E      E   E  ",
    "P  E E        E E  P",
    "PP  E          E  PP",
    "PP E E        E E PP",
    " P E   E  N   E   EP",
    "         KTTTK      ",
    "          KKK       ",
    "                    ",
  ],
};

// Static paws — no animation so Ink never re-renders due to Burrow
const ARMS_IDLE = [
  " KD        DK ",
  "KLLK      KLLK",
  " KK        KK ",
  "              ",
];

// ─── Rendering ───────────────────────────────────────────────────────────────

function applyOverlay(grid: string[][], rows: string[], sx: number, sy: number) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      const ch = rows[r]![c]!;
      if (ch !== ' ' && grid[sy + r]?.[sx + c] !== undefined) {
        grid[sy + r]![sx + c] = ch;
      }
    }
  }
}

function renderFrame(faceKey: string): string {
  const grid: string[][] = BASE.map(row => row.split(''));
  applyOverlay(grid, FACES[faceKey] ?? FACES['idle']!, 4, 10);
  applyOverlay(grid, ARMS_IDLE, 7, 18);

  const lines: string[] = [];
  for (let pair = 0; pair < 14; pair++) {
    let s = '';
    for (let x = 0; x < 28; x++) {
      const top = grid[pair * 2]![x]!;
      const bot = grid[pair * 2 + 1]![x]!;
      if (top === 'O' && bot === 'O') { s += ' '; }
      else if (top === 'O') { s += chalk.hex(pc(bot))('▄'); }
      else if (bot === 'O') { s += chalk.hex(pc(top))('▀'); }
      else { s += chalk.bgHex(pc(top)).hex(pc(bot))('▄'); }
    }
    lines.push(s);
  }
  return lines.join('\n');
}

// Pre-render all static frames at module load time — zero runtime cost
const FRAMES: Record<string, string> = {
  idle:     renderFrame('idle'),
  blink:    renderFrame('blink'),
  thinking: renderFrame('thinking'),
  happy:    renderFrame('happy'),
  error:    renderFrame('error'),
  typing:   renderFrame('typing'),
};

// ─── Component ───────────────────────────────────────────────────────────────────

export function Burrow({ emotion = 'idle' }: { emotion?: Emotion }) {
  // The ONLY piece of Burrow state: whether we are mid-blink.
  // Previously there was also a `faceKey` state synced via useEffect([emotion]),
  // which caused TWO stdout writes per emotion change (render with stale faceKey,
  // then render with updated faceKey). This created ghost copies in the terminal.
  //
  // Now: `displayKey` is computed DIRECTLY from the `emotion` prop — no state sync.
  // When `emotion` changes, the parent (Welcome) re-renders and Burrow immediately
  // shows the correct face. Only one write to stdout per emotion change.
  const [isBlink, setIsBlink] = useState(false);
  const tickRef   = useRef(0);
  const emotionRef = useRef(emotion);
  emotionRef.current = emotion; // kept current without causing re-renders

  useEffect(() => {
    // 600 ms tick. setState is called at most TWICE per 12-second cycle:
    //   tick N   (N % 20 === 0) → blink ON
    //   tick N+1 (N % 20 === 1) → blink OFF
    // All other ticks do nothing → zero extra Ink re-renders.
    const id = setInterval(() => {
      tickRef.current++;
      if (emotionRef.current !== 'idle') return; // non-idle: no blink
      const t = tickRef.current;
      if      (t % 20 === 0) setIsBlink(true);  // blink on
      else if (t % 20 === 1) setIsBlink(false); // blink off
    }, 600);
    return () => clearInterval(id);
  }, []); // mount once

  // face is determined purely by the prop + rare blink override — no intermediate state
  const displayKey = (emotion === 'idle' && isBlink) ? 'blink' : emotion;
  const frame = FRAMES[displayKey] ?? FRAMES['idle']!;

  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Text>{frame}</Text>
    </Box>
  );
}
