// Both IPCs that decompose a team goal inline must outlive the backend's own
// CLI budget, DECOMPOSE_TIMEOUT_SECS (commands/teams/assignments.rs):
// `decompose_team_assignment_goal` directly, and `approve_deliberation_proposal`
// through `companion_assign_team_inner`. If the wrapper gives up first, the UI
// reports failure for steps (or an assignment) the backend goes on to produce.
// The backend figure is read from the Rust source at run time so the two
// cannot drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve([]);
  }),
}));

import { decomposeTeamAssignmentGoal } from '../assignments';
import { approveDeliberationProposal } from '../teamDeliberations';

function backendBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/teams/assignments.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const DECOMPOSE_TIMEOUT_SECS: u64 = (\d+);/.exec(src);
  expect(m, 'DECOMPOSE_TIMEOUT_SECS not found').not.toBeNull();
  return Number(m![1]) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('goal decompose timeout parity', () => {
  beforeEach(() => { calls.length = 0; });

  it('decompose_team_assignment_goal outlives the backend budget', async () => {
    await decomposeTeamAssignmentGoal('t1', 'ship it');
    expect(calls[0]?.[0]).toBe('decompose_team_assignment_goal');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });

  it('approve_deliberation_proposal outlives the backend budget', async () => {
    await approveDeliberationProposal('d1');
    expect(calls[0]?.[0]).toBe('approve_deliberation_proposal');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });
});
