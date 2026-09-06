// useClaudeUsage — the single-login usage read.
//
// FIVE-MINUTE CACHE, HELD IN THE MODULE. The Monitor is an overlay that fully
// unmounts on close, and every re-open used to fire the read again — so the
// meters re-fetched, the marker jumped, and the "as of" stamp reset on every
// render of the surface. The last snapshot now lives here with its stamp;
// a mount inside the window paints it and asks the backend nothing; the poll
// runs on the same cadence; and a manual refresh is only offered once the
// window has elapsed (`canRefresh`). Mutations elsewhere are not this hook's
// concern — the single-login read has none.

import { useCallback, useEffect, useState } from 'react';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { silentCatch } from '@/lib/silentCatch';
import { claudeUsage } from '@/api/fleet/claudeUsage';
import type { ClaudeUsageSnapshot } from '@/lib/bindings/ClaudeUsageSnapshot';

/** The read is cached for this long; polls and manual refreshes both honour it. */
export const USAGE_CACHE_MS = 5 * 60_000;

let warmSnapshot: ClaudeUsageSnapshot | null = null;
let warmAt: number | null = null;

export interface ClaudeUsageState {
  snapshot: ClaudeUsageSnapshot | null;
  ipcFailed: boolean;
  /** When the snapshot was read, epoch ms; null before the first read. */
  fetchedAt: number | null;
  /** The cache window has elapsed — a manual refresh will actually read. */
  canRefresh: boolean;
  refresh: () => Promise<void>;
}

export function useClaudeUsage(enabled: boolean, now: number): ClaudeUsageState {
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshot | null>(warmSnapshot);
  const [fetchedAt, setFetchedAt] = useState<number | null>(warmAt);
  const [ipcFailed, setIpcFailed] = useState(false);

  const read = useCallback(async (force: boolean) => {
    if (!force && warmAt !== null && Date.now() - warmAt < USAGE_CACHE_MS) {
      // Fresh enough: serve the module copy (a remount may hold stale state).
      setSnapshot(warmSnapshot);
      setFetchedAt(warmAt);
      return;
    }
    try {
      const next = await claudeUsage();
      warmSnapshot = next;
      warmAt = Date.now();
      setSnapshot(next);
      setFetchedAt(warmAt);
      setIpcFailed(false);
    } catch (err) {
      silentCatch('monitor:claudeUsage')(err);
      setIpcFailed(true);
    }
  }, []);

  const poll = useCallback(() => read(false), [read]);
  usePolling(poll, { interval: USAGE_CACHE_MS, enabled, name: 'monitor:claudeUsage' });

  // A hook that was disabled at mount and enabled later still owes one read.
  useEffect(() => {
    if (enabled) void read(false);
  }, [enabled, read]);

  const refresh = useCallback(() => read(true), [read]);
  const canRefresh = fetchedAt === null || now - fetchedAt >= USAGE_CACHE_MS;

  return { snapshot, ipcFailed, fetchedAt, canRefresh, refresh };
}

/** Test hatch — the warm cache is module state. */
export function _resetClaudeUsageForTests(): void {
  warmSnapshot = null;
  warmAt = null;
}
