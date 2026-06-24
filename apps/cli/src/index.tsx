#!/usr/bin/env node
import React, { useState, createContext, useContext, useEffect } from 'react';
import { render, Box, Text, useStdout, useStdin, useApp, useInput } from 'ink';
import { Command } from 'commander';
import chalk from 'chalk';

export const IS_TTY = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
export const TTYContext = createContext(IS_TTY);

import { Welcome } from './ui/Welcome.js';
import { Splash }  from './ui/Splash.js';
import { Init }    from './ui/Init.js';
import { Status }  from './ui/Status.js';
import { Snap }    from './ui/Snap.js';
import { Pause }   from './ui/Pause.js';
import { Resume }  from './ui/Resume.js';
import { Block }   from './ui/Block.js';
import { Unblock } from './ui/Unblock.js';
import { History } from './ui/History.js';
import { CommandBar } from './ui/CommandBar.js';
import { color }   from './ui/theme.js';
import type { SepInfo } from './ui/common.js';

// ─── Chalk separator ─────────────────────────────────────────────────────────
// Written to stdout BEFORE render() so it always appears above the Ink output.
// Used for direct CLI invocations (groundhog status, groundhog snap, etc.).

function printSeparator(cmd: string): void {
  if (!process.stdout.isTTY) return;
  const cols   = process.stdout.columns || 80;
  const W      = Math.max(24, Math.min(78, cols - 4));
  const time   = new Date().toLocaleTimeString('en-GB', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const heavy  = '━'.repeat(W);
  const prefix = '  ❯  ';
  const suffix = `  ${time}  `;
  const gap    = ' '.repeat(Math.max(1, W - prefix.length - cmd.length - suffix.length));

  process.stdout.write(
    '\n' +
    chalk.hex(color.amberHi).bold(heavy) + '\n' +
    chalk.bgHex(color.amberFaint).hex(color.amberHi).bold(prefix) +
    chalk.bgHex(color.amberFaint).hex(color.text).bold(cmd) +
    chalk.bgHex(color.amberFaint)(gap) +
    chalk.bgHex(color.amberFaint).hex(color.textDim)(suffix) + '\n' +
    chalk.hex(color.amberHi).bold(heavy) + '\n'
  );
}

// ─── Screen union ─────────────────────────────────────────────────────────────
// sep is carried on the Screen object so each screen can embed it as the FIRST
// item in its own Static — guaranteed to print before any screen content.

type Screen =
  | { id: 'splash' }
  | { id: 'welcome' }
  | { id: 'init';    sep?: SepInfo }
  | { id: 'status';  sep?: SepInfo }
  | { id: 'snap';    sep?: SepInfo; copy?: boolean }
  | { id: 'history'; sep?: SepInfo; query?: string }
  | { id: 'pause';   sep?: SepInfo }
  | { id: 'resume';  sep?: SepInfo }
  | { id: 'block';   sep?: SepInfo }
  | { id: 'unblock'; sep?: SepInfo };

function parseNavCommand(raw: string): Screen {
  const parts = raw.trim().replace(/^groundhog\s+/, '').split(/\s+/);
  const sub   = parts[0] ?? '';
  switch (sub) {
    case 'init':    return { id: 'init' };
    case 'status':  return { id: 'status' };
    case 'snap': {
      const copy = parts.includes('--copy');
      return { id: 'snap', copy };
    }
    case 'pause':   return { id: 'pause' };
    case 'resume':  return { id: 'resume' };
    case 'block':   return { id: 'block' };
    case 'unblock': return { id: 'unblock' };
    case 'history': {
      const query = parts.slice(1).join(' ') || undefined;
      return { id: 'history', query };
    }
    default: return { id: 'welcome' };
  }
}

function labelForCommand(raw: string): string {
  const without = raw.trim().replace(/^groundhog\s+/, '');
  const sub     = without.split(/\s+/)[0] ?? '';
  if (!sub || sub === 'groundhog') return 'groundhog';
  return `groundhog ${without}`;
}

// ─── Root App ────────────────────────────────────────────────────────────────

function App({ initial }: { initial: Screen }) {
  const [screen,   setScreen]   = useState<Screen>(initial);
  const [isTyping, setIsTyping] = useState(false);
  const isTTY = IS_TTY;
  const { stdout }             = useStdout();
  const { isRawModeSupported } = useStdin();
  const interactive = isTTY && Boolean(isRawModeSupported);

  const [columns, setColumns] = useState(stdout.columns || 80);
  const [rows,    setRows]    = useState(stdout.rows    || 24);

  useEffect(() => {
    const onResize = () => { setColumns(stdout.columns); setRows(stdout.rows); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  function navigate(raw: string) {
    const base = parseNavCommand(raw);
    if (base.id === 'splash' || base.id === 'welcome') {
      setScreen(base);
      return;
    }
    const sep: SepInfo = {
      cmd:  labelForCommand(raw),
      time: new Date().toLocaleTimeString('en-GB', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      cols: columns,
    };
    // sep is embedded in the Screen object — each screen includes it as the FIRST
    // item in its own Static, so it prints before any screen content.
    setScreen({ ...base, sep } as Screen);
  }

  const isSplash = screen.id === 'splash';

  return (
    <TTYContext.Provider value={isTTY}>
      <Box flexDirection="column" width={columns}>
        <Box flexGrow={0}>
          {(() => {
            switch (screen.id) {
              case 'splash':
                return <Splash onDone={() => setScreen({ id: 'welcome' })} />;
              case 'welcome':
                return <Welcome isTyping={isTyping} termWidth={columns} termHeight={rows} />;
              case 'init':
                return <Init sep={screen.sep} />;
              case 'status':
                return (
                  <Status
                    sep={screen.sep}
                    onSnap={()    => navigate('snap')}
                    onHistory={()  => navigate('history')}
                    onBlock={()   => navigate('block')}
                  />
                );
              case 'snap':
                return <Snap sep={screen.sep} />;
              case 'pause':
                return <Pause sep={screen.sep} />;
              case 'resume':
                return <Resume sep={screen.sep} />;
              case 'block':
                return <Block sep={screen.sep} />;
              case 'unblock':
                return <Unblock sep={screen.sep} />;
              case 'history':
                return <History sep={screen.sep} query={screen.query} />;
            }
          })()}
        </Box>

        {!isSplash && (
          <Box flexShrink={0}>
            <CommandBar
              interactive={interactive}
              onTyping={setIsTyping}
              onSubmit={navigate}
            />
          </Box>
        )}
      </Box>
    </TTYContext.Provider>
  );
}

// ─── Placeholder ──────────────────────────────────────────────────────────────

// ─── CLI commands ─────────────────────────────────────────────────────────────

const program = new Command();
program
  .name('groundhog')
  .description('Never re-explain yourself to an AI again.')
  .version('0.1.0')
  .allowUnknownOption();

program.command('init')
  .description('First-time setup')
  .action(() => {
    printSeparator('groundhog init');
    render(<App initial={{ id: 'init' }} />);
  });

program.command('status')
  .description('Print live context snapshot')
  .action(() => {
    printSeparator('groundhog status');
    render(<App initial={{ id: 'status' }} />);
  });

program.command('snap')
  .description('Compact .ground.md to its current essential state and copy to clipboard')
  .option('--copy', 'Accepted for backward compatibility — clipboard copy always happens')
  .action((opts) => {
    printSeparator(opts.copy ? 'groundhog snap --copy' : 'groundhog snap');
    render(<App initial={{ id: 'snap', copy: opts.copy }} />);
  });

program.command('pause')
  .description('Pause capture')
  .action(() => {
    printSeparator('groundhog pause');
    render(<App initial={{ id: 'pause' }} />);
  });

program.command('resume')
  .description('Resume capture')
  .action(() => {
    printSeparator('groundhog resume');
    render(<App initial={{ id: 'resume' }} />);
  });

program.command('block')
  .description('Kill daemon and disable all capture')
  .action(() => {
    printSeparator('groundhog block');
    render(<App initial={{ id: 'block' }} />);
  });

program.command('unblock')
  .description('Restart daemon after a block')
  .action(() => {
    printSeparator('groundhog unblock');
    render(<App initial={{ id: 'unblock' }} />);
  });

program.command('history')
  .description('Open TUI timeline')
  .argument('[query]', 'Semantic search query')
  .action((query) => {
    printSeparator(query ? `groundhog history ${query}` : 'groundhog history');
    render(<App initial={{ id: 'history', query }} />);
  });

// No subcommand → Welcome via Splash (no separator — this is the entry point)
if (process.argv.length <= 2) {
  render(<App initial={{ id: 'splash' }} />);
} else {
  program.parse(process.argv);
}
