// @vitest-environment node
// The build-test IPC must outlive the backend's own run budget.
// `test_build_draft` (commands/design/build_sessions.rs) awaits
// `run_tool_tests` inline, whose two model legs are capped at TEST_PLAN_TIMEOUT
// and TEST_SUMMARY_TIMEOUT (engine/build_session/tool_tests.rs), with the
// scripted probes between them. If the wrapper gives up first, the UI reports a
// failed test while the backend goes on to write the report and `test_complete`.
// The backend figures are read from the Rust source at run time so the two
// cannot drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({});
  }),
}));

import { testBuildDraft } from '../buildSession';

function legSecs(src: string, name: string): number {
  const m = /const (\w+): Duration = Duration::from_secs\((\d+)\);/g;
  let hit: RegExpExecArray | null = null;
  for (let r = m.exec(src); r; r = m.exec(src)) if (r[1] === name) hit = r;
  expect(hit, `${name} not found`).not.toBeNull();
  return Number(hit![2]);
}

function backendModelLegsMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/engine/build_session/tool_tests.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return (legSecs(src, 'TEST_PLAN_TIMEOUT') + legSecs(src, 'TEST_SUMMARY_TIMEOUT')) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('test_build_draft timeout parity', () => {
  it('the IPC timeout is longer than both model legs together', async () => {
    const budget = backendModelLegsMs();
    expect(budget).toBeGreaterThan(0);
    await testBuildDraft('s1', 'p1');
    expect(calls[0]?.[0]).toBe('test_build_draft');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
