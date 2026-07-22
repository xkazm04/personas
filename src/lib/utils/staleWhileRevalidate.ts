/**
 * Lightweight stale-while-revalidate cache for async fetches.
 *
 * Returns cached data instantly while revalidating in the background.
 * Deduplicates concurrent requests to the same key automatically.
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const _inflight = new Map<string, Promise<unknown>>();

/** Default TTL: 30 seconds */
const DEFAULT_TTL_MS = 30_000;

/**
 * Hard cap on retained cache entries. TTL only gates freshness, not
 * retention -- without a size cap, a long-lived desktop session accumulates
 * one entry per distinct key forever when keys are derived from anything
 * variadic (per-persona/per-execution ids). Evicted in insertion order
 * (`Map` preserves insertion order; re-`set`ting a key on cache hit refreshes
 * its position), which approximates LRU well enough for a soft memory cap.
 */
const MAX_CACHE_ENTRIES = 500;

function evictOldestIfOverCap(): void {
  while (_cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
  }
}

export interface SWRResult<T> {
  /** The data (possibly stale). `undefined` only on first fetch. */
  data: T | undefined;
  /** Whether a background revalidation is in progress. */
  isRevalidating: boolean;
}

/**
 * Creates a stale-while-revalidate fetcher for a given cache key.
 *
 * - If cached data exists and is within `ttlMs`, returns it without fetching.
 * - If cached data exists but is stale, returns it AND kicks off a background
 *   revalidation. The returned promise resolves with the fresh data.
 * - If no cached data exists, fetches fresh data (no stale fallback).
 * - Concurrent calls with the same key share a single in-flight promise.
 */
export function createSWRFetcher<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  return async (): Promise<{ data: T; fromCache: boolean }> => {
    const cached = _cache.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();

    // Fresh cache hit — return immediately, no fetch
    if (cached && now - cached.fetchedAt < ttlMs) {
      return { data: cached.data, fromCache: true };
    }

    // Deduplicate: if already in-flight, wait for it
    const existing = _inflight.get(key);
    if (existing) {
      const data = (await existing) as T;
      return { data, fromCache: false };
    }

    // Start fetch
    const promise = fn()
      .then((data) => {
        // Refresh insertion order on write so recently-used keys stay ahead
        // of the eviction cursor.
        _cache.delete(key);
        _cache.set(key, { data, fetchedAt: Date.now() });
        evictOldestIfOverCap();
        return data;
      })
      .finally(() => {
        _inflight.delete(key);
      });

    _inflight.set(key, promise);

    // If we have stale data, return it immediately but still await in background
    if (cached) {
      // Fire-and-forget: the promise updates the cache when it resolves
      promise.catch(() => {
        /* stale fallback — swallow background errors */
      });
      return { data: cached.data, fromCache: true };
    }

    const data = await promise;
    return { data, fromCache: false };
  };
}

/** Invalidate a specific cache key so the next fetch is forced. */
export function invalidateSWRCache(key: string): void {
  _cache.delete(key);
}

/** Clear all SWR cache entries. Useful for testing. */
export function clearSWRCache(): void {
  _cache.clear();
  _inflight.clear();
}
