// @vitest-environment node
// The LLM topology IPC must outlive the backend's own run budget.
// `run_llm_topology_request` (commands/teams/teams.rs) runs a StructuredJson
// Claude call under `with_escalation`, so a rejected first answer is retried
// once: two legs of TEAM_BUILDER_TIMEOUT_SECS each, inline. If the wrapper
// gives up first, the canvas reports a failure the backend is about to answer.
// The backend figure is read from the Rust source at run time so the two
// cannot drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ members: [], connections: [] });
  }),
}));

import { suggestTopologyLlm } from '../teams';

function backendBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/teams/teams.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const TEAM_BUILDER_TIMEOUT_SECS: u64 = (\d+);/.exec(src);
  expect(m, 'TEAM_BUILDER_TIMEOUT_SECS not found').not.toBeNull();
  const body = src.slice(src.indexOf('async fn run_llm_topology_request'));
  expect(body.length, 'run_llm_topology_request not found').toBeGreaterThan(30);
  const legs = /with_escalation\(\s*TEAM_BUILDER_CLASS/.test(body) ? 2 : 1;
  return Number(m![1]) * 1000 * legs;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('suggest_topology_llm timeout parity', () => {
  it('the IPC timeout is longer than both escalation legs', async () => {
    const budget = backendBudgetMs();
    expect(budget).toBeGreaterThanOrEqual(240_000);
    await suggestTopologyLlm('a research crew');
    expect(calls[0]?.[0]).toBe('suggest_topology_llm');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
