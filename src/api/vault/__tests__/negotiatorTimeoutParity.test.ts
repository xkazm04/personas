// The step-help IPC must outlive the backend's own run budget. The command
// `get_negotiation_step_help` (commands/credentials/negotiator.rs) runs a
// Claude prompt inline with a hard timeout; if the wrapper gives up first, the
// UI reports a failure for an answer the backend is about to return. The
// backend figure is read from the Rust source at run time so the two cannot
// drift silently. Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ answer: '', updated_url: null });
  }),
}));

import { getNegotiationStepHelp } from '../negotiator';

function backendStepHelpTimeoutSecs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/credentials/negotiator.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const fnStart = src.indexOf('fn get_negotiation_step_help');
  expect(fnStart, 'get_negotiation_step_help not found').toBeGreaterThan(-1);
  const m = /run_claude_prompt(?:_tracked)?\(\s*[^,]+,\s*[^,]+,\s*(\d+)\s*,/.exec(src.slice(fnStart));
  expect(m, 'run_claude_prompt timeout literal not found').not.toBeNull();
  return Number(m![1]);
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('negotiator step-help timeout parity', () => {
  it('the IPC timeout is longer than the backend run budget', async () => {
    const secs = backendStepHelpTimeoutSecs();
    expect(secs).toBeGreaterThan(0);
    await getNegotiationStepHelp('stripe', 0, 'Create a key', 'where is it?');
    expect(calls).toHaveLength(1);
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(secs * 1000);
  });
});
