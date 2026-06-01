/**
 * Module-scope value cache with a TTL freshness window (survives unmount).
 *
 * The value-storing complement to {@link createCachedFetch}. `createCachedFetch`
 * tracks only a freshness *timestamp* — it works when the fetched data lives in
 * a Zustand store (so the data itself survives a component unmount). When a
 * component instead holds its fetched data in local `useState`, that data is
 * lost on unmount, so a timestamp-only gate would skip the refetch and leave
 * the remounted component empty. This cache stores the value itself at module
 * scope, so a remount within the TTL window can seed local state from the
 * cache and skip the IPC entirely.
 *
 * Mirrors the inline `configCache` pattern (ConfigResolutionPanel) and the
 * `lastPipelineRun` gate (useExecutionDashboardPipeline) as a reusable
 * primitive — established by the /architect perf scan (per-visit-refetch
 * convention gap). The caller still owns its own state writes and error
 * handling; this only holds `{ value, at }` per key and gates on freshness.
 *
 * Single-resource callers pass one constant key (e.g. `'stats'`); per-resource
 * callers key by id (personaId, kbId, …). Invalidate a key after a mutation
 * that changes the underlying data so the next read refetches.
 */
export interface TtlValueCache<V, K = string> {
  /** The cached value if set and still within the TTL window, else undefined. */
  get(key: K): V | undefined;
  /** Store a value for `key` and stamp the current time. */
  set(key: K, value: V): void;
  /** Drop `key` so the next `get` misses (e.g. after a mutation invalidates it). */
  delete(key: K): void;
  /** Drop every entry. */
  clear(): void;
}

export function createTtlValueCache<V, K = string>(ttlMs: number): TtlValueCache<V, K> {
  const store = new Map<K, { value: V; at: number }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      return undefined;
    },
    set(key, value) {
      store.set(key, { value, at: Date.now() });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}
