import React from 'react';
import { Box, Text } from 'ink';
import { color } from './theme.js';

// ─── Run separator (Ink version) ─────────────────────────────────────────────
// Embedded as the FIRST item in each screen's own Static so it is guaranteed
// to appear in stdout before any screen content, regardless of Ink's render order.

export interface SepInfo { cmd: string; time: string; cols: number; }

export function RunSepItem({ sep }: { sep: SepInfo }) {
  const W      = Math.max(24, Math.min(78, sep.cols - 4));
  const heavy  = '━'.repeat(W);
  const prefix = '  ❯  ';
  const suffix = `  ${sep.time}  `;
  const gap    = ' '.repeat(Math.max(1, W - prefix.length - sep.cmd.length - suffix.length));
  const BG     = color.amberFaint;   // #3d1f04 — subtle amber wash
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <Text color={color.amberHi} bold>{heavy}</Text>
      <Box>
        <Text backgroundColor={BG} color={color.amberHi} bold>{prefix}</Text>
        <Text backgroundColor={BG} color={color.text}    bold>{sep.cmd}</Text>
        <Text backgroundColor={BG} color={BG}                >{gap}</Text>
        <Text backgroundColor={BG} color={color.textDim}     >{suffix}</Text>
      </Box>
      <Text color={color.amberHi} bold>{heavy}</Text>
    </Box>
  );
}

// ─── Terminal chrome bar ──────────────────────────────────────────────────────
export function TBar({ title }: { title: string }) {
  return (
    <Box paddingX={1}>
      <Text color="#ff5f57">● </Text>
      <Text color="#febc2e">● </Text>
      <Text color="#28c840">● </Text>
      <Text color={color.textFaint}>  {title}</Text>
    </Box>
  );
}

// ─── Horizontal rule ──────────────────────────────────────────────────────────
export function HDivider({ width = 60 }: { width?: number }) {
  return <Text color={color.border}>{'─'.repeat(width)}</Text>;
}

// ─── Terminal prompt line ─────────────────────────────────────────────────────
export function TPrompt({ value = '', showCursor = true }: { value?: string; showCursor?: boolean }) {
  return (
    <Box>
      <Text color={color.greenHi}>❯ </Text>
      <Text color={color.text}>{value}</Text>
      {showCursor && !value && <Text color={color.greenHi} bold>█</Text>}
    </Box>
  );
}

// ─── Dot indicator ────────────────────────────────────────────────────────────
export function Dot({ dotColor = color.dot.green, label }: { dotColor?: string; label: string }) {
  return (
    <Box>
      <Text color={dotColor}>● </Text>
      <Text color={color.textDim}>{label}</Text>
    </Box>
  );
}

// ─── GCB field row (label + value, single line) ───────────────────────────────
export function GCBField({
  label,
  value,
  labelColor = color.blue,
  valueColor = color.text,
}: {
  label: string;
  value: string;
  labelColor?: string;
  valueColor?: string;
}) {
  return (
    <Box>
      <Text color={labelColor} bold>{label.padEnd(10)}</Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

// ─── GCB field with description (label + value + explanation line) ───────────
// Use this when the user needs to understand WHAT each field means.
export function GCBFieldFull({
  label,
  value,
  desc,
  labelColor = color.blue,
  valueColor = color.text,
}: {
  label: string;
  value: string;
  desc: string;
  labelColor?: string;
  valueColor?: string;
}) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={labelColor} bold>{label.padEnd(10)}</Text>
        <Text color={valueColor}>{value}</Text>
      </Box>
      <Box paddingLeft={10}>
        <Text color={color.textFaint}>↳ {desc}</Text>
      </Box>
    </Box>
  );
}

// ─── Snap result card ─────────────────────────────────────────────────────────
export interface SnapRecord {
  project: string;
  time:    string;
  confidence: number;
}

export function SnapRow({ snap, active = false }: { snap: SnapRecord; active?: boolean }) {
  return (
    <Box
      borderStyle={active ? 'single' : undefined}
      borderColor={active ? color.amberDim : undefined}
      paddingX={active ? 1 : 0}
      justifyContent="space-between"
    >
      <Text color={active ? color.amberHi : color.text}>{snap.project}</Text>
      <Box gap={2}>
        <Text color={color.textFaint}>{snap.confidence.toFixed(2)}</Text>
        <Text color={color.textFaint}>{snap.time}</Text>
      </Box>
    </Box>
  );
}

// ─── Footer bar ───────────────────────────────────────────────────────────────
export function FooterBar({ items }: { items: Array<{ key: string; label: string; color?: string }> }) {
  return (
    <Box paddingX={1} gap={2}>
      {items.map(({ key, label, color: c }, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text color={color.textFaint}>·</Text>}
          <Box>
            <Text color={c ?? color.amberHi} bold>{key}</Text>
            <Text color={color.textFaint}> {label}</Text>
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

// ─── Spinner frames ───────────────────────────────────────────────────────────
export const SPIN_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

// ─── Step line (init flow) ────────────────────────────────────────────────────
export type StepState = 'pending' | 'running' | 'done' | 'warn' | 'skip';

export function StepLine({
  state,
  label,
  tick = 0,
}: {
  state: StepState;
  label: string;
  tick?: number;
}) {
  const icons: Record<StepState, string> = {
    pending: '  ',
    running: SPIN_FRAMES[tick % SPIN_FRAMES.length]! + ' ',
    done:    '✓ ',
    warn:    '? ',
    skip:    '– ',
  };
  const colors: Record<StepState, string> = {
    pending: color.textFaint,
    running: color.amberHi,
    done:    color.greenHi,
    warn:    color.amber,
    skip:    color.textFaint,
  };
  return (
    <Box>
      <Text color={colors[state]}>{icons[state]}</Text>
      <Text color={state === 'done' ? color.text : state === 'running' ? color.amberHi : color.textDim}>
        {label}
      </Text>
    </Box>
  );
}
