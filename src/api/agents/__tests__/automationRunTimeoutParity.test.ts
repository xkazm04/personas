// The automation trigger IPC must outlive the backend's own run budget.
// `trigger_automation` / `test_automation_webhook` await `invoke_automation`
// (engine/src/automation_runner.rs) inline: up to `retry_count.clamp(1, 5)`
// attempts of `timeout_ms.max(1000)` each, with capped exponential backoff
// between them. If the wrapper gives up first, the UI reports a failed trigger
// while the backend goes on to fire the webhook. The backend figures are read
// from the Rust source at run time so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
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

import {
  AUTOMATION_MAX_ATTEMPTS,
  AUTOMATION_MAX_BACKOFF_MS,
  AUTOMATION_MIN_ATTEMPT_MS,
  automationRunBudgetMs,
  testAutomationWebhook,
  triggerAutomation,
} from '../automations';

function rustSource(): string {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/engine/src/automation_runner.rs'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function only(src: string, re: RegExp, what: string): string {
  const all = [...src.matchAll(new RegExp(re.source, 'g'))];
  expect(all.length, `${what}: a regex that finds nothing is a broken matcher`).toBeGreaterThan(0);
  const values = new Set(all.map((m) => m[1]));
  expect(values.size, `${what} disagrees with itself`).toBe(1);
  return all[0]![1]!;
}

/** The Rust worst case for one invoke_automation call, in ms. */
function rustWorstCaseMs(timeoutMs: number, retryCount: number): number {
  const src = rustSource();
  const maxAttempts = Number(only(src, /retry_count\.clamp\(1,\s*(\d+)\)/, 'attempt clamp'));
  const maxBackoff = Number(only(src, /const MAX_BACKOFF_MS: u64 = ([\d_]+);/, 'MAX_BACKOFF_MS').replace(/_/g, ''));
  const minAttempt = Number(only(src, /timeout_ms\.max\((\d+)\)/, 'per-attempt floor'));
  const attempts = Math.min(Math.max(retryCount, 1), maxAttempts);
  let backoff = 0;
  for (let n = 1; n < attempts; n++) backoff += Math.min(1000 * 2 ** (n - 1), maxBackoff);
  return attempts * Math.max(timeoutMs, minAttempt) + backoff;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('automation trigger timeout parity', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('mirrors the Rust attempt clamp, backoff cap and per-attempt floor', () => {
    const src = rustSource();
    expect(AUTOMATION_MAX_ATTEMPTS).toBe(Number(only(src, /retry_count\.clamp\(1,\s*(\d+)\)/, 'attempt clamp')));
    expect(AUTOMATION_MAX_BACKOFF_MS).toBe(
      Number(only(src, /const MAX_BACKOFF_MS: u64 = ([\d_]+);/, 'MAX_BACKOFF_MS').replace(/_/g, '')),
    );
    expect(AUTOMATION_MIN_ATTEMPT_MS).toBe(Number(only(src, /timeout_ms\.max\((\d+)\)/, 'per-attempt floor')));
  });

  it.each([
    [30_000, 1],
    [120_000, 1],
    [30_000, 3],
    [3_600_000, 5],
    [10, 99],
  ])('outlives a run of timeout %i ms x retry_count %i', async (timeoutMs, retryCount) => {
    const worst = rustWorstCaseMs(timeoutMs, retryCount);
    expect(automationRunBudgetMs({ timeoutMs, retryCount })).toBeGreaterThan(worst);

    await triggerAutomation('a1', null, null, { timeoutMs: BigInt(timeoutMs), retryCount });
    await testAutomationWebhook('a1', { timeoutMs, retryCount });
    expect(calls.map((c) => c[0])).toEqual(['trigger_automation', 'test_automation_webhook']);
    for (const c of calls) expect(resolvedTimeoutMs(c)).toBeGreaterThan(worst);
  });

  it('a two-minute webhook no longer times out at the 90 s IPC default', async () => {
    await triggerAutomation('a1', null, null, { timeoutMs: 120_000, retryCount: 1 });
    expect(rustWorstCaseMs(120_000, 1)).toBeGreaterThan(DEFAULT_IPC_TIMEOUT_MS);
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(rustWorstCaseMs(120_000, 1));
  });

  it('falls back to a long ceiling when the settings are unknown', async () => {
    await testAutomationWebhook('a1');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(DEFAULT_IPC_TIMEOUT_MS);
  });
});
