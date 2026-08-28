import { describe, it, expect, beforeEach, vi } from 'vitest';

const invokeWithTimeout = vi.fn();

vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeWithTimeout(...args),
}));

const silentCatchHandler = vi.fn();
const silentCatch = vi.fn((_context: string) => silentCatchHandler);

// Only the two functions `liveRoadmap.ts` imports. `extractMessage` is stubbed
// with the one branch these cases exercise (an `Error`), which is what the real
// one does for them too — the assertion under test is the classification, not
// the message extraction.
vi.mock('@/lib/silentCatch', () => ({
  extractMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  silentCatch: (ctx: string) => silentCatch(ctx),
}));

import { fetchLiveRoadmap } from './liveRoadmap';

/**
 * The literal `Err(...)` strings `src-tauri/src/commands/live_roadmap.rs`
 * produces. Classification is a string match because that is the only channel
 * the command offers — so these cases are the contract, and this table is where
 * a rename on the Rust side becomes visible instead of silently degrading every
 * failure to `unknown`.
 */
const CASES: [string, string, boolean][] = [
  ['fetch failed: error sending request', 'offline', false],
  ['client build failed: bad config', 'offline', false],
  ['unexpected status 503', 'http', false],
  ['Tauri invoke "fetch_roadmap" timed out after 90000ms', 'timeout', false],
  ['parse failed: expected value at line 1', 'schema', true],
  ['unsupported schema_version 2, expected 1', 'schema', true],
  ['payload too large: 900000 bytes (max 500000)', 'schema', true],
  ['release.version must be "roadmap", got "next"', 'schema', true],
  ['release.items must contain at least one item', 'schema', true],
  ['i18n.en.items["3"] has an empty title', 'schema', true],
  ['something nobody anticipated', 'unknown', false],
];

describe('fetchLiveRoadmap failure classification', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    silentCatch.mockClear();
    silentCatchHandler.mockClear();
  });

  it.each(CASES)('classifies %j as %s', async (message, kind, structural) => {
    invokeWithTimeout.mockRejectedValue(new Error(message));
    const outcome = await fetchLiveRoadmap();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe(kind);
    expect(outcome.failure.structural).toBe(structural);
    expect(outcome.failure.message).toContain(message);
  });

  it('reports ONLY structural failures — a tunnel must not page anyone', async () => {
    invokeWithTimeout.mockRejectedValue(new Error('fetch failed: connection reset'));
    await fetchLiveRoadmap();
    expect(silentCatch).not.toHaveBeenCalled();

    invokeWithTimeout.mockRejectedValue(new Error('unsupported schema_version 2, expected 1'));
    await fetchLiveRoadmap();
    expect(silentCatch).toHaveBeenCalledTimes(1);
    expect(silentCatchHandler).toHaveBeenCalledTimes(1);
  });

  it('passes a success straight through', async () => {
    const result = {
      roadmap: { schemaVersion: 1, release: { version: 'roadmap', status: 'roadmap', items: [] }, i18n: {} },
      fetchedAt: '2026-08-27T10:00:00Z',
      source: 'network' as const,
    };
    invokeWithTimeout.mockResolvedValue(result);
    const outcome = await fetchLiveRoadmap({ force: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toBe(result);
    expect(invokeWithTimeout).toHaveBeenCalledWith('fetch_roadmap', { force: true });
  });
});
