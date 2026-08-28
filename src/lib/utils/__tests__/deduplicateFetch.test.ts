import { describe, it, expect, beforeEach } from 'vitest';
import {
  deduplicateFetch,
  deduplicateKeyedFetch,
  invalidateDeduplicatedFetch,
  clearDeduplicatedFetches,
} from '../deduplicateFetch';

/** A promise whose resolution this test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('deduplicateFetch', () => {
  beforeEach(() => {
    clearDeduplicatedFetches();
  });

  it('coalesces concurrent calls onto one request', async () => {
    let calls = 0;
    const d = deferred<string>();
    const fetcher = deduplicateFetch('k-dedupe', () => {
      calls += 1;
      return d.promise;
    });
    const a = fetcher();
    const b = fetcher();
    d.resolve('value');
    expect(await a).toBe('value');
    expect(await b).toBe('value');
    expect(calls).toBe(1);
  });

  // Regression guard. This module had no invalidation door at all, so a caller
  // that had to bypass a request already in the air could not, and a rejected
  // in-flight promise was replayed to every concurrent caller with no reset.
  it('invalidation forces the next call to start a fresh request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const fetcher = deduplicateFetch('k-invalidate', () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const inflight = fetcher();
    invalidateDeduplicatedFetch('k-invalidate');

    const refetch = fetcher();
    expect(calls).toBe(2);

    first.resolve('stale');
    await inflight;
    second.resolve('fresh');
    expect(await refetch).toBe('fresh');
  });

  // The identity guard's whole job: the disowned request's `finally` must not
  // delete the in-flight entry belonging to the newer request that replaced it.
  it('a disowned request does not evict the newer one from the in-flight map', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const fetcher = deduplicateFetch('k-evict', () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const a = fetcher();
    invalidateDeduplicatedFetch('k-evict');
    const b = fetcher();
    expect(calls).toBe(2);

    // Settle the disowned first request; the second must still be deduplicated.
    first.resolve('one');
    await a;
    const c = fetcher();
    expect(calls).toBe(2);

    second.resolve('two');
    expect(await b).toBe('two');
    expect(await c).toBe('two');
  });

  it('releases the key after a rejection so the next call retries', async () => {
    let calls = 0;
    const fetcher = deduplicateFetch('k-reject', () => {
      calls += 1;
      return Promise.reject(new Error(`boom-${calls}`));
    });
    await expect(fetcher()).rejects.toThrow('boom-1');
    await expect(fetcher()).rejects.toThrow('boom-2');
    expect(calls).toBe(2);
  });
});

describe('deduplicateKeyedFetch', () => {
  beforeEach(() => {
    clearDeduplicatedFetches();
  });

  it('tracks distinct arguments independently', async () => {
    const seen: number[] = [];
    const fetcher = deduplicateKeyedFetch('events', async (limit: number) => {
      seen.push(limit);
      return limit;
    });
    expect(await fetcher(50)).toBe(50);
    expect(await fetcher(100)).toBe(100);
    expect(seen).toEqual([50, 100]);
  });

  it('is invalidatable through the composed key', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    let calls = 0;
    const fetcher = deduplicateKeyedFetch('events', (_limit: number) => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const inflight = fetcher(50);
    invalidateDeduplicatedFetch('events:[50]');
    const refetch = fetcher(50);
    expect(calls).toBe(2);

    first.resolve(1);
    await inflight;
    second.resolve(2);
    expect(await refetch).toBe(2);
  });
});
