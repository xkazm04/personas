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
 * `staleWhileRevalidate` uses, and for the same reason. That cross-reference is
 * no longer only prose: `__tests__/inflightCoalescing.parity.test.ts` drives
 * both modules through one lifecycle script, so a rule fixed here and not there
 * fails a test instead of waiting to be re-found by hand.
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
 * same coalescing concept and had drifted to different lifecycle rules — which
 * is what `__tests__/inflightCoalescing.parity.test.ts` now watches for.
 *
 * The key is used verbatim — for `deduplicateKeyedFetch`, build it with
 * {@link deduplicatedFetchKey}.
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
 * Derive the in-flight key for one argument list.
 *
 * This was `JSON.stringify(args)`, which is wrong for a cache key in three
 * separate ways, each of which collapses or breaks calls the wrapper exists to
 * keep apart:
 *
 *  - `undefined` and `null` both serialize to `null`, so `f(undefined)` and
 *    `f(null)` shared one promise. They are encoded distinctly here.
 *  - a function or symbol argument serializes to `null`, so two unrelated calls
 *    collapsed onto one key. They now throw a named error instead of silently
 *    sharing a result — the identity simply cannot be expressed in a key.
 *  - a circular argument made `JSON.stringify` THROW, so a deduplication helper
 *    prevented the very fetch it exists to share. Cycles are marked instead.
 *
 * Object keys are sorted so `{a,b}` and `{b,a}` describe the same request.
 */
export function deduplicatedFetchKey(prefix: string, args: readonly unknown[]): string {
  const path = new WeakSet<object>();

  const encode = (value: unknown): string => {
    if (value === undefined) return 'u';
    if (value === null) return 'z';
    const type = typeof value;
    if (type === 'function' || type === 'symbol') {
      throw new TypeError(
        `deduplicateKeyedFetch("${prefix}"): a ${type} argument has no stable cache key. ` +
          'Pass primitives or plain serializable objects.',
      );
    }
    if (type === 'bigint') return `g${String(value)}`;
    if (type !== 'object') return JSON.stringify(value) ?? 'u';

    const obj = value as object;
    if (path.has(obj)) return '~cycle';
    path.add(obj);
    const body = Array.isArray(obj)
      ? `[${obj.map(encode).join(',')}]`
      : `{${Object.keys(obj as Record<string, unknown>)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${encode((obj as Record<string, unknown>)[k])}`)
          .join(',')}}`;
    path.delete(obj);
    return body;
  };

  return `${prefix}:[${args.map(encode).join(',')}]`;
}

/**
 * Same as `deduplicateFetch` but derives the cache key from the arguments,
 * so e.g. `fetchRecentEvents(50)` and `fetchRecentEvents(100)` are tracked
 * independently. See {@link deduplicatedFetchKey} for the key rules.
 */
export function deduplicateKeyedFetch<Args extends unknown[], T>(
  prefix: string,
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return (...args: Args) => {
    const key = deduplicatedFetchKey(prefix, args);
    const existing = _inflight.get(key);
    if (existing) return existing as Promise<T>;
    return track(key, () => fn(...args));
  };
}
