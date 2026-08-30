/**
 * Unit tests for the comparisonDiffWorkerClient LRU caches.
 *
 * jsdom (vitest's default DOM env) has no `Worker` global, so `getWorker()`
 * resolves to `null` and every call below takes the synchronous fallback path
 * in `computeLineDiffOffThread`/`computeJsonDiffOffThread` — no worker mocking
 * needed to exercise the cache logic itself.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeLineDiffOffThread,
  computeJsonDiffOffThread,
  __getComparisonCacheStats,
  __resetComparisonCachesForTests,
} from '../comparisonDiffWorkerClient';

describe('comparisonDiffWorkerClient caches', () => {
  beforeEach(() => {
    __resetComparisonCachesForTests();
  });

  it('caches a line-diff result for the same (left, right) pair', async () => {
    const left = 'a\nb\nc';
    const right = 'a\nb\nd';
    const chunks: unknown[] = [];

    const first = await computeLineDiffOffThread(left, right, (c) => chunks.push(c)).promise;
    const stats1 = __getComparisonCacheStats();
    expect(stats1.lineSize).toBe(1);

    const second = await computeLineDiffOffThread(left, right, (c) => chunks.push(c)).promise;
    expect(second).toEqual(first);
    // Still one entry — the second call was a cache hit, not a new insert.
    expect(__getComparisonCacheStats().lineSize).toBe(1);
  });

  it('caches a json-diff result for the same (left, right) pair', async () => {
    const left = '{"a":1}';
    const right = '{"a":2}';

    const first = await computeJsonDiffOffThread(left, right).promise;
    expect(__getComparisonCacheStats().jsonSize).toBe(1);

    const second = await computeJsonDiffOffThread(left, right).promise;
    expect(second).toEqual(first);
    expect(__getComparisonCacheStats().jsonSize).toBe(1);
  });

  it('evicts the least-recently-used line-diff entry past the cap, and a re-request recomputes correctly', async () => {
    // Fill one entry past the cap (24) with distinct pairs so each gets its
    // own cache key.
    const pairs = Array.from({ length: 25 }, (_, i) => ({
      left: `line-${i}-a\nline-${i}-b`,
      right: `line-${i}-a\nline-${i}-c`,
    }));

    for (const { left, right } of pairs) {
      await computeLineDiffOffThread(left, right, () => undefined).promise;
    }

    const stats = __getComparisonCacheStats();
    // Cap holds: the 25th insert evicted the oldest (pairs[0]) entry.
    expect(stats.lineSize).toBe(24);
    expect(stats.lineEvictions).toBe(1);

    // The evicted key (pairs[0]) is gone from the cache, but re-requesting it
    // still recomputes the correct diff instead of erroring or returning stale
    // data — eviction only drops the memoized result, not correctness.
    const recomputed = await computeLineDiffOffThread(pairs[0]!.left, pairs[0]!.right, () => undefined)
      .promise;
    expect(recomputed).toEqual([
      { type: 'same', text: `line-0-a` },
      { type: 'removed', text: `line-0-b` },
      { type: 'added', text: `line-0-c` },
    ]);
    // Recomputing the evicted key re-inserts it and evicts pairs[1] in turn.
    expect(__getComparisonCacheStats().lineEvictions).toBe(2);
  });

  it('evicts the least-recently-used json-diff entry past the cap', async () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({
      left: JSON.stringify({ v: i, k: 'a' }),
      right: JSON.stringify({ v: i, k: 'b' }),
    }));

    for (const { left, right } of pairs) {
      await computeJsonDiffOffThread(left, right).promise;
    }

    const stats = __getComparisonCacheStats();
    expect(stats.jsonSize).toBe(24);
    expect(stats.jsonEvictions).toBe(1);

    // Re-requesting the evicted (first) pair still recomputes successfully.
    const recomputed = await computeJsonDiffOffThread(pairs[0]!.left, pairs[0]!.right).promise;
    expect(recomputed.length).toBeGreaterThan(0);
  });

  it('touching a cached entry keeps it from being the next eviction victim', async () => {
    const pairs = Array.from({ length: 24 }, (_, i) => ({
      left: `x-${i}-a`,
      right: `x-${i}-b`,
    }));
    for (const { left, right } of pairs) {
      await computeLineDiffOffThread(left, right, () => undefined).promise;
    }
    expect(__getComparisonCacheStats().lineSize).toBe(24);

    // Touch the oldest entry (pairs[0]) so it becomes the most-recently-used.
    await computeLineDiffOffThread(pairs[0]!.left, pairs[0]!.right, () => undefined).promise;

    // Insert one more distinct pair — this should evict pairs[1] (now the
    // true LRU), not pairs[0].
    await computeLineDiffOffThread('new-a', 'new-b', () => undefined).promise;
    expect(__getComparisonCacheStats().lineEvictions).toBe(1);

    // pairs[0] is still cached: re-requesting it doesn't trigger another
    // eviction bump beyond the one above (no re-insert needed on a hit).
    const evictionsBefore = __getComparisonCacheStats().lineEvictions;
    await computeLineDiffOffThread(pairs[0]!.left, pairs[0]!.right, () => undefined).promise;
    expect(__getComparisonCacheStats().lineEvictions).toBe(evictionsBefore);
  });
});
