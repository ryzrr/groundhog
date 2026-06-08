import { simpleGit } from 'simple-git';
import type { GitEvent } from '@groundhog/shared';
import { log } from './log.js';

// ─── GitPoller ────────────────────────────────────────────────────────────────

export interface GitPoller {
  start(intervalMs: number, handler: (e: GitEvent) => void): void;
  stop(): void;
  getState(): Promise<GitState>;
}

export interface GitState {
  branch: string;
  lastCommitHash: string;
  lastCommitMessage: string;
}

export function createGitPoller(projectPath: string, projectName: string): GitPoller {
  const git = simpleGit(projectPath);
  let lastHash   = '';
  let lastBranch = '';
  let timer: NodeJS.Timeout | null = null;
  let handler: ((e: GitEvent) => void) | null = null;

  async function getState(): Promise<GitState> {
    const [logResult, branch] = await Promise.all([
      git.log(['--max-count=1']),
      git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'HEAD'),
    ]);
    return {
      branch:            branch.trim(),
      lastCommitHash:    logResult.latest?.hash    ?? '',
      lastCommitMessage: logResult.latest?.message ?? '',
    };
  }

  async function tick(): Promise<void> {
    try {
      const state = await getState();

      if (state.branch !== lastBranch && lastBranch !== '') {
        handler?.({
          type:    'branch',
          project: projectName,
          branch:  state.branch,
          ts:      Date.now(),
        });
      }
      lastBranch = state.branch;

      if (state.lastCommitHash && state.lastCommitHash !== lastHash) {
        if (lastHash !== '') {
          // Only emit commit events after bootstrap — ignore very first read
          handler?.({
            type:    'commit',
            project: projectName,
            branch:  state.branch,
            message: state.lastCommitMessage,
            hash:    state.lastCommitHash,
            ts:      Date.now(),
          });
        }
        lastHash = state.lastCommitHash;
      }
    } catch (err) {
      // Not a git repo, detached HEAD, permission error — skip this tick silently
      log('debug', `Git poll error for ${projectName}: ${String(err)}`);
    }
  }

  return {
    async start(intervalMs, h) {
      handler = h;
      // Bootstrap: read current state so we don't fire false events on first tick
      try {
        const state = await getState();
        lastHash   = state.lastCommitHash;
        lastBranch = state.branch;
        log('info', `Git poller started for ${projectName} (branch=${state.branch})`);
      } catch {
        log('debug', `Could not bootstrap git state for ${projectName}`);
      }
      timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    getState,
  };
}
