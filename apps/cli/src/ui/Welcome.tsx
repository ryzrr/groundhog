import React, { useContext, useState } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
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
] as const;

const LOGO_COLORS = [color.amberHi, color.amberHi, color.amber, color.amber, color.amberDim, color.amberFaint] as const;

// ─── Static data ──────────────────────────────────────────────────────────────

const WORKFLOW = [
  {
    n: '①',
    title: 'Groundhog watches your work silently in the background',
    detail: 'Reads git commits, file saves, and terminal output. No interruptions.',
  },
  {
    n: '②',
    title: 'You run  groundhog snap  when switching to an AI tool',
    detail: 'Distills everything into a ~180-token Groundhog Context Block (GCB).',
  },
  {
    n: '③',
    title: 'Paste the GCB into Claude, Cursor, ChatGPT — anything',
    detail: 'AI instantly knows your task, stack, errors, and decisions. Zero re-explaining.',
  },
] as const;

const PROJECTS = [
  { name: 'mosaic-xr', path: '~/dev/mosaic-xr', stack: 'Next.js · Supabase · TypeScript', snap: '4m ago' },
  { name: 'groundhog', path: '~/dev/groundhog', stack: 'Node.js · SQLite · TypeScript',   snap: '5h ago' },
] as const;

const COMMANDS = [
  { cmd: 'init',    short: 'First-time setup',          detail: 'Scans for git repos, installs hooks, starts the background daemon' },
  { cmd: 'status',  short: 'See your current context',  detail: 'Shows everything Groundhog knows about your active project' },
  { cmd: 'snap',    short: 'Generate your context block', detail: 'Compresses work history to ~180 tokens — paste into any AI' },
  { cmd: 'sync',    short: 'Restore a saved context',   detail: 'Load a previous snapshot  --project <name>' },
  { cmd: 'pause',   short: 'Pause capture',             detail: 'Daemon stays alive, context capture pauses' },
  { cmd: 'block',   short: 'Fully disable Groundhog',   detail: 'No capture, no network, daemon killed  --until <time>' },
  { cmd: 'history', short: 'Browse context history',    detail: 'TUI timeline of all snaps with semantic search  [query]' },
] as const;

// ─── Body component ───────────────────────────────────────────────────────────

function WelcomeBody({ termWidth }: { termWidth: number }) {
  const W = Math.min(78, termWidth - 2);
  const div = '─'.repeat(W);

  return (
    <Box flexDirection="column" paddingBottom={1}>

      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        {LOGO.map((line, i) => (
          <Text key={i} color={LOGO_COLORS[i % LOGO_COLORS.length]} bold>{line}</Text>
        ))}
        <Box marginTop={1}>
          <Text color={color.textDim}>Never re-explain yourself to an AI again.  </Text>
          <Text color={color.textFaint}>v0.1.0</Text>
        </Box>
      </Box>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Box flexDirection="column" paddingX={2}>
        <Text color={color.border}>{div}</Text>
        <Box gap={2} alignItems="center">
          <Text color={color.amberHi} bold>HOW IT WORKS</Text>
          <Text color={color.textFaint}>— the three-step loop that eliminates AI re-explaining</Text>
        </Box>
        <Text color={color.border}>{div}</Text>

        {WORKFLOW.map(({ n, title, detail }) => (
          <Box key={n} flexDirection="column" marginBottom={0}>
            <Box gap={2}>
              <Text color={color.amberHi} bold>{n}</Text>
              <Text color={color.text}>{title}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={color.textFaint}>{detail}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* ── Daemon + tracked projects ─────────────────────────────────────── */}
      <Box flexDirection="column" paddingX={2} marginTop={1}>
        <Text color={color.border}>{div}</Text>
        <Box gap={2} alignItems="center">
          <Text color={color.amberHi} bold>DAEMON STATUS</Text>
          <Text color={color.dot.green}>●</Text>
          <Text color={color.textDim}>watching  ·  PID 48291  ·  2 projects tracked</Text>
        </Box>
        <Text color={color.border}>{div}</Text>

        {PROJECTS.map((p) => (
          <Box key={p.name} marginBottom={0}>
            <Box width={12} flexShrink={0} gap={1}>
              <Text color={color.dot.amber}>●</Text>
              <Text color={color.amberHi} bold>{p.name}</Text>
            </Box>
            <Box width={26} flexShrink={0}>
              <Text color={color.textFaint}>{p.path}</Text>
            </Box>
            <Box width={32} flexShrink={0}>
              <Text color={color.textDim}>{p.stack}</Text>
            </Box>
            <Text color={color.textFaint}>last snap {p.snap}</Text>
          </Box>
        ))}
      </Box>

      {/* ── Commands ─────────────────────────────────────────────────────── */}
      <Box flexDirection="column" paddingX={2} marginTop={1}>
        <Text color={color.border}>{div}</Text>
        <Box gap={2} alignItems="center">
          <Text color={color.amberHi} bold>COMMANDS</Text>
          <Text color={color.textFaint}>— type any command below, or just press Enter</Text>
        </Box>
        <Text color={color.border}>{div}</Text>

        {COMMANDS.map(({ cmd, short, detail }) => (
          <Box key={cmd} flexDirection="column" marginBottom={0}>
            <Box>
              <Box width={10} flexShrink={0}>
                <Text color={color.amberHi} bold>{cmd}</Text>
              </Box>
              <Text color={color.text} bold>{short}</Text>
            </Box>
            <Box paddingLeft={10}>
              <Text color={color.textFaint}>{detail}</Text>
            </Box>
          </Box>
        ))}

        <Text color={color.border}>{div}</Text>
        <Box gap={2}>
          <Text color={color.textFaint}>q quit</Text>
          <Text color={color.textFaint}>·</Text>
          <Text color={color.textFaint}>type  groundhog &lt;command&gt;  below to navigate</Text>
        </Box>
      </Box>

    </Box>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
// All content → Static (printed once, frozen). Live area = CommandBar only (3 lines).

export function Welcome({
  termWidth,
  termHeight: _termHeight,
}: {
  isTyping?:  boolean;
  termWidth:  number;
  termHeight: number;
}) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  const [items] = useState<Array<{ id: string; w: number }>>(() => [
    { id: 'body', w: termWidth },
  ]);

  useInput((input, key) => {
    if (key.escape || input === 'q') exit();
  }, { isActive: isTTY });

  return (
    <Static items={items}>
      {({ id, w }) => <WelcomeBody key={id} termWidth={w} />}
    </Static>
  );
}
