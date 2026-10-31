// @vitest-environment node
// `companion_send_message` runs a whole Athena turn inline: it first waits for
// the conversation's turn lock and assembles the prompt, THEN starts the CLI
// under TURN_TIMEOUT (companion/session/turn.rs), then persists the reply. A
// wrapper that waits exactly TURN_TIMEOUT always loses that tie: the UI shows a
// bare IPC timeout while the backend goes on to report (and persist) its own
// outcome. The backend's remote path already waits deliberately longer
// (REMOTE_TURN_TIMEOUT). The figure is read from the Rust source at run time so
// the two cannot drift silently. Lives under __tests__/, which tsc skips
// (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({});
  }),
}));

import { companionSendMessage } from '@/api/companion';

function turnTimeoutMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/session/events.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const TURN_TIMEOUT: Duration = Duration::from_secs\(([\d\s*]+)\);/.exec(src);
  expect(m, 'TURN_TIMEOUT not found').not.toBeNull();
  // The constant must be the one that bounds the CLI leg of a turn.
  const turn = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/session/turn.rs'), 'utf8');
  expect(turn).toMatch(/timeout\(\s*TURN_TIMEOUT,/);
  return m![1]!.split('*').reduce((acc, n) => acc * Number(n.trim()), 1) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('companion chat turn IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('waits past the backend TURN_TIMEOUT, not merely to it', async () => {
    const budget = turnTimeoutMs();
    await companionSendMessage('hi');
    expect(calls[0]![0]).toBe('companion_send_message');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
