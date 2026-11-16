// @vitest-environment node
// The auto-cred browser IPC must outlive the backend's own hard process
// deadline. `start_auto_cred_browser` (commands/credentials/auto_cred_browser.rs)
// first probes Playwright availability (bounded by a timeout), then runs the
// CLI + Chromium under BROWSER_TIMEOUT_SECS (Playwright mode) or
// GUIDED_TIMEOUT_SECS (guided mode). If the wrapper gives up first, the UI
// abandons a live CLI the backend is about to kill and report on, which is the
// orphan BROWSER_SESSION_TIMEOUT_MS's doc comment exists to prevent. The
// backend figures are read from the Rust source at run time so the two cannot
// drift silently. Lives under __tests__/, which tsc skips (node:fs).
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

import { startAutoCredBrowser } from '../autoCredBrowser';
import type { AutoCredBrowserRequest } from '../autoCredBrowser';

/** Rust source with comments removed, so prose describing a budget can never
 *  satisfy the matcher. */
const RUST = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/commands/credentials/auto_cred_browser.rs'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

function constSecs(name: string): number {
  const m = new RegExp(`const ${name}: u64 = (\\d+);`).exec(RUST);
  expect(m, `${name} not found in auto_cred_browser.rs; update this pin`).not.toBeNull();
  return Number(m![1]);
}

/** The Playwright availability probe runs before the session deadline starts. */
function probeTimeoutSecs(): number {
  const start = RUST.indexOf('async fn check_playwright_available_async');
  expect(start, 'check_playwright_available_async not found').toBeGreaterThan(-1);
  const end = RUST.indexOf('\nfn ', start + 1);
  const body = RUST.slice(start, end === -1 ? undefined : end);
  const m = /tokio::time::timeout\(\s*std::time::Duration::from_secs\((\d+)\)/.exec(body);
  expect(m, 'availability probe timeout not found').not.toBeNull();
  return Number(m![1]);
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

const REQUEST: AutoCredBrowserRequest = {
  session_id: 's1',
  connector_name: 'stripe',
  connector_label: 'Stripe',
  docs_url: null,
  setup_instructions: null,
  fields: [],
  saved_procedure: null,
  force_guided: null,
  service_url: null,
  service_description: null,
};

describe('auto-cred browser timeout parity', () => {
  it('reads real backend budgets (not a vacuous pin)', () => {
    expect(constSecs('BROWSER_TIMEOUT_SECS')).toBeGreaterThan(0);
    expect(constSecs('GUIDED_TIMEOUT_SECS')).toBeGreaterThan(0);
    expect(probeTimeoutSecs()).toBeGreaterThan(0);
  });

  it('the IPC timeout outlives the probe plus the longer of the two session deadlines', async () => {
    const sessionSecs = Math.max(constSecs('BROWSER_TIMEOUT_SECS'), constSecs('GUIDED_TIMEOUT_SECS'));
    const backendCeilingMs = (probeTimeoutSecs() + sessionSecs) * 1000;
    await startAutoCredBrowser(REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('start_auto_cred_browser');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendCeilingMs);
  });
});
