// @vitest-environment node
// `dev_tools_athena_triage_batch` runs ONE headless Athena turn inline
// (`cli_text_tracked_on` -> `cli_text_inner` in companion/athena_reaction.rs,
// a hard stream cap plus a 5 s kill wait) and only then persists the verdicts
// as a pending approval. If the IPC wrapper gives up first (the 90 s default),
// the verdict card shows an error while the backend goes on to write the
// approval, and a retry spends a second LLM turn on the same batch. The
// backend figure is read from the Rust source at run time so the two cannot
// drift silently. Lives under __tests__/, which tsc skips (node:fs).
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

import { athenaTriageBatch } from '@/api/devTools/devTools';

/** `cli_text_inner`'s stream cap + its post-timeout kill wait, in ms. */
function headlessLegBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/athena_reaction.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('async fn cli_text_inner(');
  expect(start, 'cli_text_inner not found').toBeGreaterThanOrEqual(0);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const cap = /let timeout = std::time::Duration::from_secs\((\d+)\);/.exec(body);
  expect(cap, 'cli_text_inner stream cap not found').not.toBeNull();
  const kill = /tokio::time::timeout\(std::time::Duration::from_secs\((\d+)\), child\.wait\(\)\)/.exec(body);
  expect(kill, 'cli_text_inner kill wait not found').not.toBeNull();
  // The triage batch must still reach that leg (one call per batch).
  const triage = readFileSync(
    resolve(process.cwd(), 'src-tauri/src/companion/proactive/backlog_triage.rs'),
    'utf8',
  );
  expect(triage.split('cli_text_tracked_on(').length - 1).toBe(1);
  return (Number(cap![1]) + Number(kill![1])) * 1000;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('athena backlog triage IPC timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('waits past the headless leg budget', async () => {
    const budget = headlessLegBudgetMs();
    await athenaTriageBatch(['idea-1']);
    expect(calls[0]![0]).toBe('dev_tools_athena_triage_batch');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(budget);
  });
});
