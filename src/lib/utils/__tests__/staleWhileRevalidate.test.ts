import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSWRFetcher,
  invalidateSWRCache,
  clearSWRCache,
} from '../staleWhileRevalidate';

/** A promise whose resolution this test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createSWRFetcher', () => {
  beforeEach(() => {
    clearSWRCache();
  });

  it('serves a fresh cache hit without refetching', async () => {
    let calls = 0;
    const fetcher = createSWRFetcher('k-fresh', async () => {
      calls += 1;
      return calls;
    });
    expect(await fetcher()).toEqual({ data: 1, fromCache: false });
    expect(await fetcher()).toEqual({ data: 1, fromCache: true });
    expect(calls).toBe(1);
  });

  it('deduplicates concurrent calls to the same key', async () => {
    let calls = 0;
    const d = deferred<string>();
    const fetcher = createSWRFetcher('k-dedupe', () => {
      calls += 1;
      return d.promise;
    });
    const a = fetcher();
    const b = fetcher();
    d.resolve('value');
    expect((await a).data).toBe('value');
    expect((await b).data).toBe('value');
    expect(calls).toBe(1);
  });

  // Regression guard. `invalidateSWRCache` used to delete only the cache entry,
  // so a request already in the air stayed registered as in-flight AND still
  // wrote its result back on settle. The next call therefore awaited the
  // pre-invalidation request and re-cached exactly the data that was
  // invalidated. Pins the fixed behaviour and forbids the old.
  it('invalidation disowns a request that was already in flight', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const fetcher = createSWRFetcher('k-invalidate', () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const inflight = fetcher();
    invalidateSWRCache('k-invalidate');

    // The disowned request lands. It must NOT repopulate the cache.
    first.resolve('stale');
    await inflight;

    // The next call must start a real second request, not reuse the first.
    const refetch = fetcher();
    expect(calls).toBe(2);

    second.resolve('fresh');
    const result = await refetch;
    expect(result.data).toBe('fresh');
    expect(result.data).not.toBe('stale');

    // And the cache now holds the fresh value, not the disowned one.
    const readBack = await fetcher();
    expect(readBack).toEqual({ data: 'fresh', fromCache: true });
  });

  // Regression guard for the FIFO-documented-as-LRU defect. The fresh-hit path
  // used to return before touching the map, so only a WRITE refreshed a key's
  // position: a key read on every render but never restale kept its original
  // insertion slot and was evicted first, which is the exact opposite of what
  // the `MAX_CACHE_ENTRIES` doc promised.
  it('a fresh cache hit refreshes the key against the eviction cursor', async () => {
    const MAX = 500;
    const read = async (k: string) =>
      createSWRFetcher(k, async () => `v-${k}`, 60_000)();

    // Fill the cache to the cap. `hot` is the very first key inserted, so under
    // insertion-order-only eviction it is the first one dropped.
    await read('hot');
    for (let i = 0; i < MAX - 1; i += 1) await read(`filler-${i}`);

    // Touch `hot` — a fresh hit, no fetch. This must move it to the back.
    expect(await read('hot')).toEqual({ data: 'v-hot', fromCache: true });

    // One more distinct key pushes the cache over the cap and evicts one entry.
    await read('overflow');

    // `hot` survived (it was re-set on the hit); the oldest untouched filler did not.
    expect(await read('hot')).toEqual({ data: 'v-hot', fromCache: true });
    expect(await read('filler-0')).toEqual({ data: 'v-filler-0', fromCache: false });
  });

  it('a disowned request does not evict a newer request from the in-flight map', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const fetcher = createSWRFetcher('k-evict', () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const a = fetcher();
    invalidateSWRCache('k-evict');
    const b = fetcher();
    expect(calls).toBe(2);

    // Settle the disowned first request; the second must still be deduplicated.
    first.resolve('one');
    await a;
    const c = fetcher();
    second.resolve('two');
    expect((await b).data).toBe('two');
    expect((await c).data).toBe('two');
    expect(calls).toBe(2);
  });
});
