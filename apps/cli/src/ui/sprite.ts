import chalk from 'chalk';
import { color } from './theme.js';

const PALETTE: Record<string, string> = {
  'K': '#3d1f04', // Outline (amberFaint)
  'M': '#d97706', // Main fur (amber)
  'D': '#78350f', // Dark fur shading (amberDim)
  'L': '#fde68a', // Snout/belly (amber-200)
  'E': '#0f0a05', // Eyes
  'N': '#7f1d1d', // Mouth (redDim)
  'W': '#ffffff', // Tooth
  'P': '#f472b6', // Pink blush!
};

const ROWS = [
  '.....KKKK.....',
  '...KKMMMMKK...',
  '..KDMMMMMMDK..',
  '.KDMMMMMMMMDK.',
  '.KDMEMMMMEMDK.',
  'KDMPPLLLLPPMDK',
  'KDDMLLNWNLLDDK',
  'KDDMMLLLLMMDDK',
  '.KDDMMMMMMDDK.',
  '.KDLLLLLLLLDK.',
  '.KDLLLLLLLLDK.',
  '.KDLLLLLLLLDK.',
  '..KDDMMMMDDK..',
  '..KDMK..KMDK..',
  '...KK....KK...',
  '..............',
];

// Eye positions for blink animation: row 4, cols 4 and 9
const EYE_ROW = 4;
const EYE_COLS = [4, 9];

function pixelColor(ch: string, row: number, col: number, eyeOpen: boolean): string {
  if (ch === 'E') {
    if (row === EYE_ROW && EYE_COLS.includes(col) && !eyeOpen) {
      return PALETTE['M']!; // blink: replace eye with fur color
    }
    return PALETTE['E']!;
  }
  if (ch === '.') return color.surface;
  return PALETTE[ch] ?? color.surface;
}

export function renderSprite(eyeOpen = true, bobOffset = 0): string[] {
  const lines: string[] = [];
  const width = ROWS[0]!.length;

  // bobOffset shifts the sprite down by adding blank lines at top
  const blankLine = chalk.bgHex(color.bg)(' '.repeat(width));
  for (let b = 0; b < bobOffset; b++) lines.push(blankLine);

  // Render pairs of rows using half-block (▄) technique:
  // bg = top pixel, fg = bottom pixel
  for (let pair = 0; pair < ROWS.length / 2; pair++) {
    const topRowStr = ROWS[pair * 2]!;
    const botRowStr = ROWS[pair * 2 + 1]!;
    let line = '';

    for (let x = 0; x < width; x++) {
      const topCh = topRowStr[x] ?? '.';
      const botCh = botRowStr[x] ?? '.';
      const topC = pixelColor(topCh, pair * 2, x, eyeOpen);
      const botC = pixelColor(botCh, pair * 2 + 1, x, eyeOpen);
      line += chalk.bgHex(topC).hex(botC)('▄');
    }

    lines.push(line);
  }

  // Fill remaining blank lines if bobOffset shrinks visible height
  for (let b = 0; b < (bobOffset > 0 ? 1 : 0); b++) lines.push(blankLine);

  return lines;
}
