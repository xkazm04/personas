// @vitest-environment node
// `advance_team_goal` LLM-decomposes the goal INLINE when it has no open to-dos:
// engine::goal_advance::advance_goal awaits matching::decompose_goal under its own
// DECOMPOSE_TIMEOUT_SECS (src-tauri/src/engine/goal_advance.rs) before it creates
// and starts the assignment. If the wrapper gives up first, the Goals UI reports a
// failure for an assignment the backend goes on to create - and a retry inside
// the decompose window is not caught by the AlreadyAdvancing guard (no assignment
// row exists yet), so it decomposes and spawns a second one.
// The backend figure is read from the Rust source at run time so the two cannot
// drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve(null);
  }),
}));

import { advanceTeamGoal } from '../assignments';

function backendBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/engine/goal_advance.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const DECOMPOSE_TIMEOUT_SECS: u64 = (\d+);/.exec(src);
  expect(m, 'DECOMPOSE_TIMEOUT_SECS not found').not.toBeNull();
  expect(src, 'advance_goal no longer decomposes inline').toMatch(/decompose_goal\([^)]*DECOMPOSE_TIMEOUT_SECS\)\s*\.await/);
  return Number(m![1]) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('advance_team_goal timeout parity', () => {
  it('the IPC outlives the inline goal decompose', async () => {
    await advanceTeamGoal('team-1', 'goal-1');
    expect(calls[0]?.[0]).toBe('advance_team_goal');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });
});
