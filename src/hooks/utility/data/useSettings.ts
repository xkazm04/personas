import { useEffect, useMemo, useState } from 'react';
import { getAppSettingsBulk } from '@/api/system/settings';
import { createLogger } from '@/lib/log';

const logger = createLogger('use-settings');

/**
 * Microtask-level coalescer for app-settings reads.
 *
 * Settings panels typically mount several `useAppSetting` hooks at once
 * (one per child component). Each hook used to issue its own
 * `get_app_setting` invoke, producing a waterfall of serial IPC calls
 * even though they all fire from the same React render.
 *
 * This module collects every read requested in a single tick and flushes
 * them as a single `get_app_settings_bulk` invoke at the end of the
 * microtask, so the IPC cost scales with the *number of distinct ticks*
 * rather than the number of subscribed keys.
 *
 * Rejection of the underlying invoke fans out to every pending caller so
 * none silently hangs.
 */

interface PendingRead {
  resolve: (v: string | null) => void;
  reject: (e: unknown) => void;
}

let pendingByKey = new Map<string, PendingRead[]>();
let scheduled = false;

function flushBatch() {
  const batch = pendingByKey;
  pendingByKey = new Map();
  scheduled = false;
  if (batch.size === 0) return;

  const keys = Array.from(batch.keys());
  getAppSettingsBulk(keys).then(
    (result) => {
      for (const [key, waiters] of batch) {
        const value = result[key] ?? null;
        for (const w of waiters) w.resolve(value);
      }
    },
    (err) => {
      logger.error('Bulk settings read failed', {
        keyCount: keys.length,
        err: err instanceof Error ? err.message : String(err),
      });
      for (const waiters of batch.values()) {
        for (const w of waiters) w.reject(err);
      }
    },
  );
}

/**
 * Read a single app setting, transparently coalesced with any other reads
 * issued in the same microtask into a single `get_app_settings_bulk` call.
 *
 * Drop-in replacement for `getAppSetting` for read paths that benefit from
 * batching. Write paths should continue to use `setAppSetting` directly.
 */
export function getAppSettingCoalesced(key: string): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const arr = pendingByKey.get(key);
    if (arr) {
      arr.push({ resolve, reject });
    } else {
      pendingByKey.set(key, [{ resolve, reject }]);
    }
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flushBatch);
    }
  });
}

interface UseSettingsResult {
  /** Map from key → value (or `null` if absent). Keys are populated once `loaded` flips to true. */
  values: Record<string, string | null>;
  /** True after the bulk read settles (success or error). */
  loaded: boolean;
  /** Error message if the bulk read failed; reads fall back to `null` per key. */
  error: string | null;
}

/**
 * Load several settings in a single Tauri invoke. The underlying batch is
 * shared with any concurrent `useAppSetting` calls in the same microtask
 * via {@link getAppSettingCoalesced}, so partial overlap with other panels
 * does not cost extra round-trips.
 *
 * The returned `values` map is empty until the read completes, then contains
 * an entry for every requested key (`null` if the key was absent or the
 * read failed). Callers that need typed values (numbers, JSON) should
 * derive them with `useMemo` from `values[key]`.
 *
 * The hook re-fetches when the *content* of `keys` changes, not its
 * reference — pass an inline array or memoised list, both are fine.
 */
export function useSettings(keys: readonly string[]): UseSettingsResult {
  // Stabilise the dep on key contents. Sorting + joining keeps the dep stable
  // across renders that pass equivalent-but-distinct array references.
  const stableSignature = useMemo(() => [...keys].sort().join('\x1f'), [keys]);
  const stableKeys = useMemo(
    () => stableSignature.split('\x1f').filter(Boolean),
    [stableSignature],
  );

  const [values, setValues] = useState<Record<string, string | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (stableKeys.length === 0) {
      setValues({});
      setLoaded(true);
      setError(null);
      return;
    }

    setLoaded(false);
    setError(null);
    getAppSettingsBulk(stableKeys)
      .then((result) => {
        if (cancelled) return;
        // Ensure every requested key is present in the map (Rust guarantees
        // this, but be defensive against shape drift).
        const next: Record<string, string | null> = {};
        for (const k of stableKeys) next[k] = result[k] ?? null;
        setValues(next);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('useSettings bulk read failed', { keyCount: stableKeys.length, err: message });
        setError(message);
        // Surface a fully-populated map so consumers don't crash on undefined.
        const next: Record<string, string | null> = {};
        for (const k of stableKeys) next[k] = null;
        setValues(next);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [stableSignature]);

  return { values, loaded, error };
}
