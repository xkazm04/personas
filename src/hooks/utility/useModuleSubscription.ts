import { useEffect, useReducer } from 'react';

// ── ModuleCache: module-level shared cache with pub/sub ───────────────

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
}

/**
 * Create a module-level cache backed by a `Map<K, V>` with a built-in
 * pub/sub mechanism. Components subscribe via `useModuleSubscription` and
 * re-render when `notify()` is called after mutations.
 *
 * This is intentionally module-scoped (not React context) so the cache
 * survives component unmount/remount cycles and is accessible from
 * non-React code.
 */
export function createModuleCache<K, V>(): ModuleCache<K, V> {
  const data = new Map<K, V>();
  const subscribers = new Set<() => void>();

  function notify() {
    for (const cb of subscribers) cb();
  }

  return {
    get: (key) => data.get(key),
    set: (key, value) => { data.set(key, value); },
    delete: (key) => data.delete(key),
    has: (key) => data.has(key),
    clear: () => { data.clear(); },
    notify,
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
    get subscriberCount() { return subscribers.size; },
  };
}

// ── React hook ────────────────────────────────────────────────────────

/**
 * Subscribe to a `ModuleCache` and return the value for `key`.
 * The component re-renders whenever `cache.notify()` is called.
 */
export function useModuleSubscription<K, V>(
  cache: ModuleCache<K, V>,
  key: K,
): V | undefined {
  const [, rerender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => cache.subscribe(rerender), [cache, rerender]);

  return cache.get(key);
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
