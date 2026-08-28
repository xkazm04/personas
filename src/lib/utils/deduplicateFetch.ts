/**
 * Coalesces concurrent calls to the same async function.
 *
 * If `fn` is already in-flight, subsequent calls return the same promise
 * instead of starting a new IPC round-trip. Once the promise settles, the
 * next call will start a fresh invocation.
 *
 * Keyed variant (`deduplicateKeyedFetch`) allows deduplication per argument
 * (e.g. different limit values should not share a promise).
 */

const _inflight = new Map<string, Promise<unknown>>();

/**
 * Identity of the request currently owning each key — the same mechanism
 * `staleWhileRevalidate` uses, and for the same reason.
 *
 * Without it, `invalidateDeduplicatedFetch` could only drop the in-flight entry,
 * and the disowned request's `finally` would then delete the entry belonging to
 * the NEWER request that replaced it — re-opening the very window the
 * invalidation was called to close. A fresh object per request is the cheapest
 * identity there is, and the entry is removed whenever the in-flight one is, so
 * this map never outgrows `_inflight`.
 */
const _requestToken = new Map<string, object>();

/** Register `promise` as the in-flight request for `key`, guarded by identity. */
function track<T>(key: string, start: () => Promise<T>): Promise<T> {
  const token = {};
  _requestToken.set(key, token);
  const promise = start().finally(() => {
    // Guarded: an unguarded delete would evict a newer request that started
    // after this one was disowned by an invalidation.
    if (_requestToken.get(key) === token) {
      _requestToken.delete(key);
      _inflight.delete(key);
    }
  });
  _inflight.set(key, promise);
  return promise;
}

/**
 * Wraps an async function so concurrent invocations with the same `key`
 * share a single in-flight promise. The wrapper preserves the original
 * function signature for zero-argument fetches.
 */
export function deduplicateFetch<T>(
  key: string,
  fn: () => Promise<T>,
): () => Promise<T> {
  return () => {
    const existing = _inflight.get(key);
    if (existing) return existing as Promise<T>;
    return track(key, fn);
  };
}

/**
 * Force the next call on `key` to start a fresh request.
 *
 * This module had no invalidation entry point at all: a caller that needed to
 * bypass a request already in the air could not, and every concurrent caller of
 * a rejected in-flight promise shared that rejection with no way to reset. The
 * sibling `staleWhileRevalidate` grew exactly this door; the two implement the
 * same coalescing concept and had drifted to different lifecycle rules.
 *
 * The key is used verbatim, so a `deduplicateKeyedFetch` entry is addressed by
 * the composed key the wrapper derives, not by its prefix alone.
 */
export function invalidateDeduplicatedFetch(key: string): void {
  _inflight.delete(key);
  _requestToken.delete(key);
}

/** Drop every in-flight registration. Useful for testing. */
export function clearDeduplicatedFetches(): void {
  _inflight.clear();
  _requestToken.clear();
}

/**
 * Same as `deduplicateFetch` but derives the cache key from the arguments,
 * so e.g. `fetchRecentEvents(50)` and `fetchRecentEvents(100)` are tracked
 * independently.
 */
export function deduplicateKeyedFetch<Args extends unknown[], T>(
  prefix: string,
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return (...args: Args) => {
    const key = `${prefix}:${JSON.stringify(args)}`;
    const existing = _inflight.get(key);
    if (existing) return existing as Promise<T>;
    return track(key, () => fn(...args));
  };
}
