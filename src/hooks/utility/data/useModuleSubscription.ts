import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react';

// -- ModuleCache: module-level shared cache with pub/sub ---------------

export interface ModuleCacheOptions {
  /** Time-to-live in milliseconds. Entries older than this are treated as absent. */
  ttlMs?: number;
  /**
   * Maximum number of resident entries. On overflow the cache evicts expired
   * entries first, then the least-recently-written ones, until it is back
   * within the bound. Omit only for a cache whose key space is a fixed set of
   * literals — a cache keyed by an entity id has no natural ceiling and must
   * pass one. Values below 1 or non-finite are clamped to 1.
   */
  maxSize?: number;
}

export interface ModuleCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
  /** Number of resident entries, expired-but-not-yet-evicted ones included. */
  readonly size: number;
  /** Broadcast to all subscribers, triggering re-renders. */
  notify(): void;
  /** Register a callback; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /** Current number of active subscribers. */
  readonly subscriberCount: number;
  /** Invalidate a single key and notify subscribers. */
  invalidate(key: K): void;
  /** Invalidate all entries and notify subscribers. */
  invalidateAll(): void;
}

/**
 * Create a module-level cache backed by a `Map<K, V>` with a built-in
 * pub/sub mechanism. Components subscribe via `useModuleSubscription` and
 * re-render when `notify()` is called after mutations.
 *
 * Optionally accepts `{ ttlMs }` to auto-expire entries after a duration and
 * `{ maxSize }` to bound how many entries stay resident. Without `maxSize` a
 * cache keyed by an entity id grows for the life of the process: `get`/`has`
 * are deliberately non-evicting, so nothing else ever removes an entry.
 *
 * This is intentionally module-scoped (not React context) so the cache
 * survives component unmount/remount cycles and is accessible from
 * non-React code.
 */
export function createModuleCache<K, V>(options?: ModuleCacheOptions): ModuleCache<K, V> {
  const data = new Map<K, V>();
  const timestamps = new Map<K, number>();
  const subscribers = new Set<() => void>();
  const ttlMs = options?.ttlMs;
  const rawMax = options?.maxSize;
  const maxSize =
    rawMax == null ? undefined : Number.isFinite(rawMax) ? Math.max(1, Math.trunc(rawMax)) : undefined;

  function notify() {
    for (const cb of subscribers) cb();
  }

  function isExpired(key: K): boolean {
    if (ttlMs == null) return false;
    const ts = timestamps.get(key);
    if (ts == null) return true;
    return Date.now() - ts > ttlMs;
  }

  function drop(key: K) {
    data.delete(key);
    timestamps.delete(key);
  }

  /**
   * Bound the cache. Runs only from `set` -- a mutation -- never from
   * `get`/`has`, which are called during render and must stay side-effect
   * free (see the note on `get` below). Expired entries go first, since they
   * already read as absent; after that the Map's insertion order is the
   * least-recently-written order, because `set` re-inserts.
   */
  function evictOverflow(protectedKey: K) {
    if (maxSize == null || data.size <= maxSize) return;
    if (ttlMs != null) {
      for (const k of [...data.keys()]) {
        if (data.size <= maxSize) break;
        if (k !== protectedKey && isExpired(k)) drop(k);
      }
    }
    for (const k of [...data.keys()]) {
      if (data.size <= maxSize) break;
      if (k === protectedKey) continue;
      drop(k);
    }
  }

  return {
    // `get` and `has` are READ-ONLY on purpose. They used to evict the expired
    // entry, which made them mutating -- and `useModuleSubscription` calls
    // `get` during render, so an expiry turned a render into a side effect.
    // An expired entry is now reported as absent and left in place; it is
    // overwritten by the next `set` and dropped by invalidate/clear.
    get: (key) => {
      if (!data.has(key)) return undefined;
      if (isExpired(key)) return undefined;
      return data.get(key);
    },
    set: (key, value) => {
      // Re-inserting rather than overwriting moves the key to the end of the
      // Map's iteration order, which is what makes that order a
      // least-recently-written order for `evictOverflow`.
      data.delete(key);
      data.set(key, value);
      if (ttlMs != null) timestamps.set(key, Date.now());
      evictOverflow(key);
    },
    delete: (key) => {
      timestamps.delete(key);
      return data.delete(key);
    },
    get size() { return data.size; },
    has: (key) => {
      if (!data.has(key)) return false;
      return !isExpired(key);
    },
    clear: () => {
      data.clear();
      timestamps.clear();
    },
    notify,
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
    get subscriberCount() { return subscribers.size; },
    invalidate: (key) => {
      data.delete(key);
      timestamps.delete(key);
      notify();
    },
    invalidateAll: () => {
      data.clear();
      timestamps.clear();
      notify();
    },
  };
}

// -- React hook --------------------------------------------------------

/**
 * Subscribe to a `ModuleCache` and return the value for `key`.
 * The component re-renders whenever `cache.notify()` is called.
 *
 * Uses `useSyncExternalStore` rather than a re-render kick + a bare
 * `cache.get()` in the render body: the old shape returned a value read
 * straight out of a mutable module Map, so the value rendered was not
 * necessarily the value that triggered the render (a tear), and concurrent
 * rendering had no way to detect the store changing mid-render.
 * `useDensity` in this same directory already used this pattern.
 */
export function useModuleSubscription<K, V>(
  cache: ModuleCache<K, V>,
  key: K,
): V | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => cache.subscribe(onStoreChange),
    [cache],
  );
  // Reads are pure (see `get` above), so the same function serves as the
  // server snapshot -- there is no client-only state to guard against.
  const getSnapshot = useCallback(() => cache.get(key), [cache, key]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to a `ModuleCache` without reading a specific key.
 * Useful when the component just needs to re-render on any change
 * (e.g. a shared ticker).
 */
export function useModuleCacheSubscription(cache: ModuleCache<unknown, unknown>): void {
  const [, rerender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => cache.subscribe(rerender), [cache, rerender]);
}
