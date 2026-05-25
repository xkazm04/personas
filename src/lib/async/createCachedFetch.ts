/**
 * @catalog Dedupe + TTL-gate an async fetch (in-flight collapse + freshness window).
 *
 * Extracts the pattern that `credentialSlice.fetchCredentials` and
 * `executionSlice.fetchExecutions` independently grew: collapse a burst of
 * concurrent callers into a single IPC (in-flight reuse) and skip refetching
 * within a freshness window (TTL). It complements `invokeWithTimeout`'s 250ms
 * in-flight auto-dedup — that catches same-tick identical calls at the IPC
 * seam; this holds a result fresh for a configurable window at the slice seam.
 *
 * The fetcher owns its own state writes (the Zustand `set`) and its own error
 * reporting (`reportError`/`toastCatch`). This controller only manages two
 * things: in-flight collapse and the freshness timestamp. The timestamp is
 * recorded only when the fetcher resolves without throwing, so a failed fetch
 * is never cached — the next caller retries.
 *
 * Keyed usage (per-persona, per-resource): pass a stable string key. For a
 * single global resource, pass one constant key.
 */
export interface CachedFetchConfig {
  /** Freshness window in milliseconds. Within this window since the last
   *  successful fetch for a key, `run` skips the fetcher (calling `onHit`). */
  ttlMs: number;
  /** When the fetcher throws, propagate the error to `run`'s caller. Default
   *  `false` — the fetcher is expected to have already reported, and `run`
   *  resolves so callers that `await` it never see an unhandled rejection. */
  rethrow?: boolean;
}

export interface CachedFetchController<K> {
  /**
   * Run `fetcher` for `key`, unless a fetch for the same key is already in
   * flight (reuse it) or the last successful fetch is still within the TTL
   * window (skip; invoke `onHit` so the caller can restore cached state).
   */
  run(key: K, fetcher: () => Promise<void>, onHit?: (key: K) => void): Promise<void>;
  /** Force the next `run` to bypass the TTL gate. Omit `key` to clear all. */
  invalidate(key?: K): void;
}

export function createCachedFetch<K = string>(
  config: CachedFetchConfig,
): CachedFetchController<K> {
  const { ttlMs, rethrow = false } = config;
  const inflight = new Map<K, Promise<void>>();
  const lastFetchedAt = new Map<K, number>();

  return {
    run(key, fetcher, onHit) {
      // Collapse concurrent callers onto the single in-flight promise.
      const existing = inflight.get(key);
      if (existing) return existing;

      // Serve from the freshness window — no fetch.
      if (Date.now() - (lastFetchedAt.get(key) ?? 0) < ttlMs) {
        onHit?.(key);
        return Promise.resolve();
      }

      const promise = (async () => {
        try {
          await fetcher();
          // Record freshness only on success, so failures aren't cached.
          lastFetchedAt.set(key, Date.now());
        } catch (err) {
          if (rethrow) throw err;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    },

    invalidate(key) {
      if (key === undefined) {
        lastFetchedAt.clear();
        inflight.clear();
      } else {
        lastFetchedAt.delete(key);
        inflight.delete(key);
      }
    },
  };
}
