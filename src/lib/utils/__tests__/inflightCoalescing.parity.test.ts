/**
 * One coalescing concept, two implementations, and — until this file — nothing
 * that compared them.
 *
 *   1. `deduplicateFetch.ts` — `_inflight` + `_requestToken`, a fresh object
 *      minted per request, the settle-time delete guarded on token identity.
 *   2. `staleWhileRevalidate.ts` — the same two maps, the same mint, the same
 *      guard, plus a cache the guard also protects.
 *
 * Both files carry a comment citing the other ("the same mechanism
 * `staleWhileRevalidate` uses, and for the same reason"), which is the whole
 * problem: the cross-reference is prose. The drift it records — one module
 * grew an invalidation door and a token guard while the sibling still deleted
 * unconditionally — was found by a human reading both files, and a fix to one
 * is still not structurally propagated to the other.
 *
 * This test is the missing comparison. Every case below is driven through BOTH
 * implementations from one script, so a lifecycle rule fixed in one module and
 * not the other fails here instead of waiting for the next human to read both
 * files side by side.
 *
 * The rules are stated in terms of REQUEST COUNT and in-flight sharing, never
 * returned data, because that is the whole of what the two share: SWR also
 * serves stale values and caches results, and `deduplicateFetch` deliberately
 * does neither.
 *
 * Verified to fail before it passed: deleting the `_requestToken.get(key) ===
 * token` guard from either module turns "a disowned request must not evict the
 * request that replaced it" red for that module alone.
 *
 * NOT covered, deliberately: `src/lib/async/createCachedFetch.ts` is a THIRD
 * in-flight registry. It has no token guard at all — its `invalidate()` drops
 * the in-flight entry and the disowned request's `finally` then deletes the
 * newer request's entry, which is exactly the bug the two modules here fixed.
 * Adding it to this script would land a behaviour change in the Zustand slices
 * that consume it, so it is recorded rather than silently repaired.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  deduplicateFetch,
  invalidateDeduplicatedFetch,
  clearDeduplicatedFetches,
} from '../deduplicateFetch';
import {
  createSWRFetcher,
  invalidateSWRCache,
  clearSWRCache,
} from '../staleWhileRevalidate';

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The surface the two modules genuinely have in common: start-or-join a
 * request for a key, disown whatever is in flight, and reset between cases.
 */
interface Coalescer {
  readonly name: string;
  /** Start a request for `key`, or join the one already in flight. */
  call(key: string, fn: () => Promise<string>): Promise<string>;
  /** Disown the in-flight request so the next `call` starts a fresh one. */
  invalidate(key: string): void;
  reset(): void;
}

const COALESCERS: readonly Coalescer[] = [
  {
    name: 'deduplicateFetch',
    call: (key, fn) => deduplicateFetch(key, fn)(),
    invalidate: invalidateDeduplicatedFetch,
    reset: clearDeduplicatedFetches,
  },
  {
    name: 'createSWRFetcher',
    // ttl 0 keeps every call on the fetch path, so this script exercises the
    // in-flight registry rather than SWR's freshness window.
    call: (key, fn) => createSWRFetcher(key, fn, 0)().then((r) => r.data),
    invalidate: invalidateSWRCache,
    reset: clearSWRCache,
  },
];

/** Let queued microtasks (the `.then`/`.finally` chains) run to completion. */
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe.each(COALESCERS)('in-flight coalescing parity: $name', (coalescer) => {
  beforeEach(() => {
    coalescer.reset();
  });

  /** Counts how many times the underlying request actually ran. */
  function counter(gate: Promise<string>) {
    const state = { calls: 0 };
    return {
      state,
      fn: () => {
        state.calls += 1;
        return gate;
      },
    };
  }

  it('collapses concurrent calls for one key onto a single request', async () => {
    const d = deferred<string>();
    const { state, fn } = counter(d.promise);

    const a = coalescer.call('parity:collapse', fn);
    const b = coalescer.call('parity:collapse', fn);
    d.resolve('v1');

    await a;
    await b;
    expect(state.calls).toBe(1);
  });

  it('keeps distinct keys on distinct requests', async () => {
    const d = deferred<string>();
    const { state, fn } = counter(d.promise);

    const a = coalescer.call('parity:key-a', fn);
    const b = coalescer.call('parity:key-b', fn);
    d.resolve('v1');

    await a;
    await b;
    expect(state.calls).toBe(2);
  });

  it('starts a fresh request once the previous one has settled', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const state = { calls: 0 };
    const fn = () => {
      state.calls += 1;
      return state.calls === 1 ? first.promise : second.promise;
    };

    const a = coalescer.call('parity:settled', fn);
    first.resolve('v1');
    await a;
    await flush();

    void coalescer.call('parity:settled', fn);
    second.resolve('v2');
    await flush();

    expect(state.calls).toBe(2);
  });

  it('never retains a rejected request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const state = { calls: 0 };
    const fn = () => {
      state.calls += 1;
      return state.calls === 1 ? first.promise : second.promise;
    };

    const a = coalescer.call('parity:rejected', fn);
    first.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await flush();

    const b = coalescer.call('parity:rejected', fn);
    second.resolve('v2');
    await b;

    expect(state.calls).toBe(2);
  });

  it('starts a fresh request after an invalidation, rather than joining the disowned one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const state = { calls: 0 };
    const fn = () => {
      state.calls += 1;
      return state.calls === 1 ? first.promise : second.promise;
    };

    const a = coalescer.call('parity:invalidate', fn);
    coalescer.invalidate('parity:invalidate');
    const b = coalescer.call('parity:invalidate', fn);

    first.resolve('v1');
    second.resolve('v2');
    await a;
    await b;

    expect(state.calls).toBe(2);
  });

  it('does not let a disowned request evict the request that replaced it', async () => {
    // The token guard, stated as behaviour. Without it, the FIRST request's
    // settle-time delete removes the SECOND request's in-flight entry, and the
    // third caller — who should have joined it — opens a third round-trip,
    // re-opening the window the invalidation was called to close.
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    const state = { calls: 0 };
    const fn = () => {
      state.calls += 1;
      if (state.calls === 1) return first.promise;
      if (state.calls === 2) return second.promise;
      return third.promise;
    };

    const a = coalescer.call('parity:disowned', fn);
    coalescer.invalidate('parity:disowned');
    const b = coalescer.call('parity:disowned', fn);

    // The disowned request lands while its replacement is still in the air.
    first.resolve('v1');
    await a;
    await flush();

    const c = coalescer.call('parity:disowned', fn);
    second.resolve('v2');
    third.resolve('v3');
    await b;
    await c;

    expect(state.calls).toBe(2);
  });
});
