import { createJSONStorage } from "zustand/middleware";

/**
 * Zustand's persist middleware re-runs partialize + setItem on every set(),
 * even when the partialized payload hasn't moved. Under load (~1000 sets/sec)
 * that's 1000 sync localStorage writes/sec for the same JSON. The dedupe
 * cuts that to one write per actual change.
 *
 * The cache is module-scoped so multiple stores can share it safely (each
 * persist key is unique per store name).
 */
const lastWritten = new Map<string, string>();

/** Reset the dedup cache. Tests only — not part of the runtime contract. */
export function _resetDedupCacheForTests(): void {
  lastWritten.clear();
}

/**
 * Inner StateStorage with write-deduplication. Use directly when you need a
 * non-JSON storage shape, or via {@link createDedupedJSONStorage} for the
 * common case.
 */
export function createDedupedStateStorage(storage: Storage = localStorage) {
  return {
    getItem: (key: string) => storage.getItem(key),
    setItem: (key: string, value: string) => {
      if (lastWritten.get(key) === value) return;
      lastWritten.set(key, value);
      storage.setItem(key, value);
    },
    removeItem: (key: string) => {
      lastWritten.delete(key);
      storage.removeItem(key);
    },
  };
}

/**
 * Drop-in replacement for `createJSONStorage(() => localStorage)` that skips
 * redundant writes when the serialized payload is unchanged.
 *
 * @example
 *   persist(slice, {
 *     name: "my-store",
 *     storage: createDedupedJSONStorage(),
 *     partialize: (s) => ({ ...selected fields }),
 *   })
 */
export function createDedupedJSONStorage(storage: Storage = localStorage) {
  return createJSONStorage(() => createDedupedStateStorage(storage));
}
