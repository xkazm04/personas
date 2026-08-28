import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react';

// -- ModuleCache: module-level shared cache with pub/sub ---------------

export interface ModuleCacheOptions {
  /** Time-to-live in milliseconds. Entries older than this are treated as absent. */
  ttlMs?: number;
}

export interface ModuleCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
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
 * Optionally accepts `{ ttlMs }` to auto-expire entries after a duration.
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

  function notify() {
    for (const cb of subscribers) cb();
  }

  function isExpired(key: K): boolean {
    if (ttlMs == null) return false;
    const ts = timestamps.get(key);
    if (ts == null) return true;
    return Date.now() - ts > ttlMs;
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
      data.set(key, value);
      if (ttlMs != null) timestamps.set(key, Date.now());
    },
    delete: (key) => {
      timestamps.delete(key);
      return data.delete(key);
    },
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
