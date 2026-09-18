import { createJSONStorage } from "zustand/middleware";
import { silentCatch } from "@/lib/silentCatch";

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

/** Keys whose write failure has already been reported, so a full disk does not
 *  produce one Sentry event per set() for the rest of the session. */
const reportedFailures = new Set<string>();

/** Reset the dedup cache. Tests only — not part of the runtime contract. */
export function _resetDedupCacheForTests(): void {
  lastWritten.clear();
  reportedFailures.clear();
}

/**
 * Inner StateStorage with write-deduplication. Use directly when you need a
 * non-JSON storage shape, or via {@link createDedupedJSONStorage} for the
 * common case.
 */
export function createDedupedStateStorage(storage: Storage = localStorage) {
  return {
    getItem: (key: string) => {
      try {
        return storage.getItem(key);
      } catch (err) {
        reportOnce(key, "getItem", err);
        return null;
      }
    },
    /**
     * Fail-soft. Every `persist()` in the app writes through this one door, so
     * a `QuotaExceededError` (full profile) or a private-mode SecurityError
     * thrown here would escape through the persist plugin on an ordinary
     * `selectPersona` / `setChatMode`. Persistence degrading to in-memory
     * session state is the correct outcome; a thrown `set()` is not.
     *
     * `lastWritten` is recorded ONLY after a successful write. Recording it
     * first (as this did until 2026-09-17) meant a failed write still poisoned
     * the dedupe cache, so the retry of the identical payload was skipped and
     * the value was never persisted at all.
     */
    setItem: (key: string, value: string) => {
      if (lastWritten.get(key) === value) return;
      try {
        storage.setItem(key, value);
        lastWritten.set(key, value);
      } catch (err) {
        lastWritten.delete(key);
        reportOnce(key, "setItem", err);
      }
    },
    removeItem: (key: string) => {
      lastWritten.delete(key);
      try {
        storage.removeItem(key);
      } catch (err) {
        reportOnce(key, "removeItem", err);
      }
    },
  };
}

/** Report a storage failure to Sentry + console once per key per session. */
function reportOnce(key: string, op: string, err: unknown): void {
  const id = `${key}:${op}`;
  if (reportedFailures.has(id)) return;
  reportedFailures.add(id);
  silentCatch(`stores/util/dedupedStorage:${op}:${key}`)(err);
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
