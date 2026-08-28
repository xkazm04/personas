import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getAppSettingsBulk } from '@/api/system/settings';
import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';

const logger = createLogger('use-settings');

/**
 * Tauri event the backend broadcasts (key only, never the value) whenever a
 * settings row is written or deleted through the command layer. `useSettings`
 * subscribes so a change made in one mounted panel refreshes every other
 * mounted reader live, without polling. Must match `SETTINGS_CHANGED_EVENT`
 * in `src-tauri/src/commands/infrastructure/settings.rs`.
 */
const SETTINGS_CHANGED_EVENT = 'settings-changed';

interface SettingsChangedPayload {
  key: string;
}

/**
 * Microtask-level coalescer for app-settings reads.
 *
 * Settings panels typically mount several `useAppSetting` hooks at once
 * (one per child component). Each hook used to issue its own
 * `get_app_setting` invoke, producing a waterfall of serial IPC calls
 * even though they all fire from the same React render.
 *
 * This module collects every read requested in a single tick and flushes
 * them as one `get_app_settings_bulk` invoke per {@link BULK_READ_MAX_KEYS}
 * keys at the end of the microtask, so the IPC cost scales with the *number
 * of distinct ticks* rather than the number of subscribed keys.
 *
 * Rejection of an invoke fans out to that chunk's pending callers so none
 * silently hangs.
 */

interface PendingRead {
  resolve: (v: string | null) => void;
  reject: (e: unknown) => void;
}

let pendingByKey = new Map<string, PendingRead[]>();
let scheduled = false;

/**
 * Hard ceiling the backend enforces on one `get_app_settings_bulk` call —
 * `GET_BATCH_MAX_KEYS` in `src-tauri/db/src/repos/core/settings.rs`, checked in
 * `commands/infrastructure/settings.rs` which returns `AppError::Validation`
 * for anything larger. The coalescer aggregates across *every* reader mounting
 * in the same tick, so its batch size is not bounded by any single call site:
 * without this split, one busy tick would reject the whole batch and every
 * waiter in it, turning a growth-driven overflow into "all settings read as
 * absent" across unrelated panels. Chunking keeps the client's rule the same
 * rule as the server's.
 */
export const BULK_READ_MAX_KEYS = 256;

function flushBatch() {
  const batch = pendingByKey;
  pendingByKey = new Map();
  scheduled = false;
  if (batch.size === 0) return;

  const keys = Array.from(batch.keys());
  for (let offset = 0; offset < keys.length; offset += BULK_READ_MAX_KEYS) {
    const chunk = keys.slice(offset, offset + BULK_READ_MAX_KEYS);
    getAppSettingsBulk(chunk).then(
      (result) => {
        for (const key of chunk) {
          const value = result[key] ?? null;
          for (const w of batch.get(key) ?? []) w.resolve(value);
        }
      },
      (err) => {
        logger.error('Bulk settings read failed', {
          keyCount: chunk.length,
          batchKeyCount: keys.length,
          err: err instanceof Error ? err.message : String(err),
        });
        // Only this chunk's waiters fail — a sibling chunk that succeeded
        // still resolves, so one bad key set cannot blank every panel.
        for (const key of chunk) {
          for (const w of batch.get(key) ?? []) w.reject(err);
        }
      },
    );
  }
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
 * Load several settings in a single Tauri invoke.
 *
 * NOTE: this hook issues its own `get_app_settings_bulk` call — it does NOT
 * go through {@link getAppSettingCoalesced}, so a panel that mixes
 * `useSettings` with sibling `useAppSetting` hooks still pays two round
 * trips in that tick. (Rerouting it through the coalescer would merge the
 * two, at the cost of merging their failure domains as well; that trade-off
 * has not been taken. This comment previously claimed the sharing already
 * happened.)
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

  // The signature is a CACHE KEY and nothing else. `stableKeys` used to be
  // `stableSignature.split('\x1f')` -- the array actually sent to the backend
  // was a round-trip through the delimiter, so any key containing it was
  // silently split into two keys that do not exist, and the miss came back as
  // `null` rather than as an error. Callers already assemble dynamic keys
  // (`execution_retention_months:${personaId}`). The array is now the sorted
  // original, held in a ref so its identity stays stable while the signature
  // does -- `keys` is usually an inline literal with a fresh identity every
  // render, and the effect below keys on this array.
  const keyCacheRef = useRef<{ signature: string; keys: string[] } | null>(null);
  if (keyCacheRef.current?.signature !== stableSignature) {
    keyCacheRef.current = { signature: stableSignature, keys: [...keys].sort().filter(Boolean) };
  }
  const stableKeys = keyCacheRef.current.keys;

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

    const keySet = new Set(stableKeys);

    const fetchAll = (markLoading: boolean) => {
      if (markLoading) {
        setLoaded(false);
        setError(null);
      }
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
          silentCatch('hooks/utility/data/useSettings:fetchAllBulk')(err);
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          logger.error('useSettings bulk read failed', {
            keyCount: stableKeys.length,
            err: message,
          });
          setError(message);
          // Surface a fully-populated map so consumers don't crash on undefined.
          const next: Record<string, string | null> = {};
          for (const k of stableKeys) next[k] = null;
          setValues(next);
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    };

    // Initial load (shows the loading state).
    fetchAll(true);

    // Direction 3: refresh live when another mounted consumer writes/deletes
    // one of our keys. The payload is key-only; we refetch (not patch) so the
    // value always comes back through the auth-checked read path. A silent
    // refresh (no loading-state flicker) keeps the UI stable.
    const unlistenPromise = listen<SettingsChangedPayload>(
      SETTINGS_CHANGED_EVENT,
      (event) => {
        if (cancelled) return;
        if (keySet.has(event.payload?.key)) {
          fetchAll(false);
        }
      },
    );

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [stableKeys, stableSignature]);

  return { values, loaded, error };
}
