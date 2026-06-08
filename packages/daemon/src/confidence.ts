import type { Signals } from './extractor.js';
import type { ExtractedFields } from './extractor.js';

const TWO_HOURS     = 2 * 60 * 60 * 1000;
const FIFTEEN_MINS  = 15 * 60 * 1000;

// Compute a 0.0–0.95 confidence score.
// Uses ExtractedFields.taskIsInferred — never a string comparison against a sentinel value.
export function computeConfidence(
  fields: ExtractedFields,
  signals: Signals,
  now: number
): number {
  let score = 0.4; // base

  // ── TASK signal ───────────────────────────────────────────────────────────
  if (!fields.taskIsInferred) {
    // Task sourced from a real commit message
    const latestCommit = signals.gitEvents
      .filter(e => e.type === 'commit')
      .sort((a, b) => b.ts - a.ts)[0];
    if (latestCommit && (now - latestCommit.ts) < TWO_HOURS) {
      score += 0.2; // fresh commit → high confidence
    } else {
      score += 0.1; // commit-sourced but stale
    }
  } else {
    score += 0.05; // branch/file heuristic — some signal
  }

  // ── STACK ─────────────────────────────────────────────────────────────────
  if (fields.stack && fields.stack.length > 0) score += 0.1;

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (fields.error) score += 0.1;

  // ── RESOLVED ─────────────────────────────────────────────────────────────
  if (fields.resolved) score += 0.1;

  // ── Active file edits ─────────────────────────────────────────────────────
  const hasRecentFile = signals.fileEvents.some(e => (now - e.ts) < FIFTEEN_MINS);
  if (hasRecentFile) score += 0.05;

  return Math.min(0.95, Math.round(score * 100) / 100);
}
