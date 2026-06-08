import { useState, useEffect, useContext } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TTYContext } from '../index.js';
import { color } from './theme.js';
import { GCBField, SPIN_FRAMES, RunSepItem, SepInfo } from './common.js';
import { DaemonClient, DaemonOfflineError } from '../daemon-client.js';
import { formatGCB } from '@groundhog/shared';
import type { GCBSnapshot } from '@groundhog/shared';

// ─── Static data ──────────────────────────────────────────────────────────────

const INJECT_TARGETS = ['cursor', 'claude', 'file', 'clipboard'] as const;
type InjectTarget = typeof INJECT_TARGETS[number];

const INJECT_INSTRUCTIONS: Record<InjectTarget, { result: string[]; steps: string[]; tip: string }> = {
  cursor: {
    result: ['✓ Written to .cursorrules in your project root'],
    steps: [
      '1  Open Cursor in this project folder',
      '2  Groundhog context is pre-loaded — no pasting needed',
      '3  Start a new chat and ask your question directly',
    ],
    tip: 'Cursor reads .cursorrules on every session open. Context is always fresh.',
  },
  claude: {
    result: ['✓ Copied to clipboard as Claude XML block'],
    steps: [
      '1  Open Claude → your Project → Project Instructions',
      '2  Paste the clipboard content into the instructions field',
      '3  Start a new conversation — Claude knows your full context',
    ],
    tip: 'Project Instructions persist across Claude sessions — paste once, works forever.',
  },
  file: {
    result: ['✓ Written to .groundhog-context.md in project root'],
    steps: [
      '1  In your AI tool, reference the file directly:',
      '     "See .groundhog-context.md for context"',
      '2  Or add @.groundhog-context.md to Cursor/Copilot context',
      '3  Update it anytime with  groundhog snap --inject file',
    ],
    tip: 'Markdown format works in any AI that accepts file attachments.',
  },
  clipboard: {
    result: ['✓ Copied to clipboard as plain text'],
    steps: [
      '1  Open any AI tool — Claude, ChatGPT, Gemini, anything',
      '2  Paste the clipboard at the start of your message',
      '3  Ask your question — AI has full context immediately',
    ],
    tip: 'Plain text works everywhere. Paste into any chat, email, or doc.',
  },
};

// ─── Injection actions ────────────────────────────────────────────────────────

async function doInject(target: InjectTarget, gcbText: string, snap: GCBSnapshot): Promise<void> {
  const { default: clipboardy } = await import('clipboardy');

  switch (target) {
    case 'clipboard':
      clipboardy.writeSync(gcbText);
      break;

    case 'claude': {
      const xml = `<context>\n${gcbText}\n</context>`;
      clipboardy.writeSync(xml);
      break;
    }

    case 'cursor': {
      const dest = path.join(process.cwd(), '.cursorrules');
      const header = `# Groundhog Context — ${snap.project}\n# Auto-generated — update with: groundhog snap --inject cursor\n\n`;
      fs.writeFileSync(dest, header + gcbText);
      break;
    }

    case 'file': {
      const dest = path.join(process.cwd(), '.groundhog-context.md');
      const md = `# Groundhog Context — ${snap.project}\n\n\`\`\`\n${gcbText}\n\`\`\`\n\n> Auto-generated — update with: \`groundhog snap --inject file\`\n`;
      fs.writeFileSync(dest, md);
      break;
    }
  }
}

// ─── Static content pieces ────────────────────────────────────────────────────

function SnapHeader({ inject, copy }: { inject?: string; copy?: boolean }) {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box gap={1}>
        <Text color={color.amberHi} bold>groundhog</Text>
        <Text color={color.textDim}>snap</Text>
        {inject  && <Text color={color.textFaint}> --inject {inject}</Text>}
        {!inject && copy && <Text color={color.textFaint}> --copy</Text>}
      </Box>
      <Box>
        <Text color={color.textFaint}>
          Compressing your work session into a ~180-token context block for AI tools.
        </Text>
      </Box>
      <Text color={color.border}>{'─'.repeat(60)}</Text>
    </Box>
  );
}

function SnapGCB({ snap }: { snap: GCBSnapshot }) {
  const date = snap.createdAt.toISOString().split('T')[0];
  return (
    <Box flexDirection="column" paddingX={2}>

      <Box gap={2}>
        <Text color={color.greenHi} bold>✓</Text>
        <Text color={color.text} bold>Snapshot compressed</Text>
        <Text color={color.greenHi} bold>{snap.tokens} tokens</Text>
      </Box>
      <Box paddingLeft={0}>
        <Text color={color.textFaint}>
          This block contains everything an AI needs to resume your session.
        </Text>
      </Box>

      <Box height={1} />

      <Box gap={2} alignItems="center">
        <Text color={color.blue} bold>GROUNDHOG CONTEXT BLOCK</Text>
        <Text color={color.textFaint}>— copy and paste this into any AI tool</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor={color.blueDim} paddingX={1}>
        <Text color={color.textFaint}>[GH·{snap.project}·{date}]</Text>
        <GCBField label="TASK:"     value={snap.task}                labelColor={color.blue} />
        <GCBField label="STACK:"    value={snap.stack}               labelColor={color.blue} />
        {snap.resolved && <GCBField label="RESOLVED:" value={snap.resolved} labelColor={color.greenHi} valueColor={color.greenHi} />}
        {snap.error    && <GCBField label="ERROR:"    value={snap.error}    labelColor={color.red}     valueColor={color.red} />}
        {snap.tried    && <GCBField label="TRIED:"    value={snap.tried}    labelColor={color.textDim}  valueColor={color.textDim} />}
        {snap.open     && <GCBField label="OPEN:"     value={snap.open}     labelColor={color.amber}   valueColor={color.amber} />}
        <GCBField label="NEXT:"     value={snap.next}                labelColor={color.blue} />
        <Text color={color.textFaint}>[continue from: {snap.error ? 'ERROR' : snap.open ? 'OPEN' : 'NEXT'}]</Text>
      </Box>
      <Box paddingLeft={0}>
        <Text color={color.textFaint}>
          ↳ Paste the block above verbatim — the AI reads the structured fields automatically.
        </Text>
      </Box>
    </Box>
  );
}

function SnapOffline() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={color.red}>Daemon is offline. Run  groundhog init  to start it.</Text>
    </Box>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tick:    number;
  sep?:    SepInfo;
  copy?:   boolean;
  inject?: string;
}

// ─── Snap screen ─────────────────────────────────────────────────────────────

export function Snap({ tick, sep, copy = false, inject }: Props) {
  const { exit } = useApp();
  const isTTY    = useContext(TTYContext);

  const defaultTarget: InjectTarget =
    (inject && INJECT_TARGETS.includes(inject as InjectTarget))
      ? inject as InjectTarget
      : copy ? 'clipboard' : 'cursor';

  type Stage = 'loading' | 'offline' | 'ready';
  const [stage,        setStage]        = useState<Stage>('loading');
  const [snap,         setSnap]         = useState<GCBSnapshot | null>(null);
  const [activeTarget, setActiveTarget] = useState<InjectTarget>(defaultTarget);
  const [injected,     setInjected]     = useState(false);
  const [injectError,  setInjectError]  = useState<string | null>(null);

  const [staticItems, setStaticItems] = useState<Array<{ id: string }>>(() => [
    ...(sep ? [{ id: 'sep' }] : []),
    { id: 'header' },
  ]);

  // Phase 1: fetch snapshot from daemon
  useEffect(() => {
    const client = new DaemonClient();
    let cancelled = false;

    async function fetch() {
      try {
        // Get status to find active project
        const statusResp = await client.send<{
          ok: true;
          state: { projects: string[] };
          snapshot: GCBSnapshot | null;
        }>({ cmd: 'status' });

        if (cancelled || !statusResp.ok) return;

        const project = statusResp.snapshot?.project
          ?? statusResp.state.projects[0]
          ?? '';

        let gotSnap: GCBSnapshot | null = null;
        if (project) {
          const snapResp = await client.send<{
            ok: true; snapshot: GCBSnapshot;
          } | { ok: false; error: string }>(
            { cmd: 'snap', project }
          );
          if (snapResp.ok) gotSnap = snapResp.snapshot;
        } else if (statusResp.snapshot) {
          gotSnap = statusResp.snapshot;
        }

        if (cancelled) return;
        setSnap(gotSnap);
        setStage('ready');
        setStaticItems(prev => [...prev, { id: 'gcb' }]);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DaemonOfflineError) {
          setStage('offline');
          setStaticItems(prev => [...prev, { id: 'offline' }]);
        } else {
          setStage('offline');
          setStaticItems(prev => [...prev, { id: 'offline' }]);
        }
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, []);

  // Phase 2: auto-inject when ready
  useEffect(() => {
    if (stage !== 'ready' || !snap) return;

    const gcbText = formatGCB(snap);
    doInject(activeTarget, gcbText, snap)
      .then(() => setInjected(true))
      .catch(err => setInjectError(String(err)));
  }, [stage, snap]);  // eslint-disable-line react-hooks/exhaustive-deps

  const doReInject = (target: InjectTarget) => {
    if (!snap) return;
    setInjected(false);
    setInjectError(null);
    const gcbText = formatGCB(snap);
    doInject(target, gcbText, snap)
      .then(() => setInjected(true))
      .catch(err => setInjectError(String(err)));
  };

  useInput((input, key) => {
    if (input === 'q' || key.escape) { exit(); return; }
    if (stage !== 'ready') return;

    if (key.leftArrow || input === 'h') {
      const idx = INJECT_TARGETS.indexOf(activeTarget);
      const next = INJECT_TARGETS[Math.max(0, idx - 1)]!;
      setActiveTarget(next);
      doReInject(next);
    }
    if (key.rightArrow || key.tab || input === 'l') {
      const idx = INJECT_TARGETS.indexOf(activeTarget);
      const next = INJECT_TARGETS[Math.min(INJECT_TARGETS.length - 1, idx + 1)]!;
      setActiveTarget(next);
      doReInject(next);
    }
    if (key.return) {
      doReInject(activeTarget);
    }
  }, { isActive: isTTY });

  const spinner      = SPIN_FRAMES[tick % SPIN_FRAMES.length]!;
  const instructions = INJECT_INSTRUCTIONS[activeTarget];

  return (
    <>
      <Static items={staticItems}>
        {({ id }) => {
          if (id === 'sep'     && sep)  return <RunSepItem key="sep" sep={sep} />;
          if (id === 'header')          return <SnapHeader key="header" inject={inject} copy={copy} />;
          if (id === 'gcb'    && snap)  return <SnapGCB key="gcb" snap={snap} />;
          if (id === 'offline')         return <SnapOffline key="offline" />;
          return null;
        }}
      </Static>

      {/* ── Live area ──────────────────────────────────────────────────────── */}
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        {stage === 'loading' ? (
          <Box gap={1}>
            <Text color={color.amber}>{spinner}</Text>
            <Text color={color.amberHi}>Compressing work session to context block…</Text>
          </Box>
        ) : stage === 'offline' ? (
          <Box gap={3}>
            <Text color={color.textFaint}>q quit</Text>
          </Box>
        ) : (
          <>
            <Text color={color.textFaint}>Where should the context block be sent?</Text>

            <Box gap={0}>
              {INJECT_TARGETS.map((t) => {
                const active = t === activeTarget;
                return (
                  <Box key={t} paddingX={2} borderStyle="single"
                    borderColor={active ? color.amberHi : color.border}>
                    <Text color={active ? color.amberHi : color.textFaint} bold={active}>
                      {active ? `▸ ${t}` : t}
                    </Text>
                  </Box>
                );
              })}
            </Box>

            {injected && (
              <Box flexDirection="column" marginTop={0}>
                {instructions.result.map((line, i) => (
                  <Text key={i} color={color.greenHi}>{line}</Text>
                ))}
                <Box height={1} />
                <Text color={color.textDim} bold>NEXT STEPS:</Text>
                {instructions.steps.map((step, i) => (
                  <Text key={i} color={color.text}>{step}</Text>
                ))}
                <Box gap={1} marginTop={0}>
                  <Text color={color.blue}>↳</Text>
                  <Text color={color.textFaint}>{instructions.tip}</Text>
                </Box>
              </Box>
            )}

            {injectError && (
              <Text color={color.red}>⚠  {injectError}</Text>
            )}

            <Text color={color.border}>{'─'.repeat(52)}</Text>
            <Box gap={3}>
              <Box gap={1}><Text color={color.amberHi} bold>←/→</Text><Text color={color.textDim}>switch target</Text></Box>
              <Box gap={1}><Text color={color.amberHi} bold>↵</Text><Text color={color.textDim}>re-inject</Text></Box>
              <Text color={color.textFaint}>q quit</Text>
            </Box>
          </>
        )}
      </Box>
    </>
  );
}
