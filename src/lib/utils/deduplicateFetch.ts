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

    const promise = fn().finally(() => {
      _inflight.delete(key);
    });
    _inflight.set(key, promise);
    return promise;
  };
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

    const promise = fn(...args).finally(() => {
      _inflight.delete(key);
    });
    _inflight.set(key, promise);
    return promise;
  };
}
