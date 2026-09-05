// useClaudeUsage — the usage strip's data. One poll on the shared coordinator,
// a module-scoped warm cache so a re-opened Monitor paints its last-known
// meters instead of ghosting (loading pattern v2, mechanic 4), and the last
// GOOD snapshot retained across a failed read (law 1: a fetch never hides what
// is already rendered). The backend caches for ~45s on its side, so this
// cadence costs at most one upstream request a minute however many Monitors
// are open.

import { useCallback, useState } from 'react';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { silentCatch } from '@/lib/silentCatch';
import { claudeUsage } from '@/api/fleet/claudeUsage';
import type { ClaudeUsageSnapshot } from '@/lib/bindings/ClaudeUsageSnapshot';

/** The strip re-reads once a minute; the windows move slowly and the
 *  countdown ticks locally between reads. */
export const USAGE_POLL_MS = 60_000;

let warmSnapshot: ClaudeUsageSnapshot | null = null;

export interface ClaudeUsageState {
  /** Last snapshot the backend produced (available or not); null before the
   *  first read of the app session. */
  snapshot: ClaudeUsageSnapshot | null;
  /** The IPC itself failed on the most recent read. Distinct from
   *  `snapshot.available === false`, which is the backend's own verdict. */
  ipcFailed: boolean;
  lastRefreshed: number | null;
}

export function useClaudeUsage(enabled: boolean): ClaudeUsageState {
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshot | null>(warmSnapshot);
  const [ipcFailed, setIpcFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await claudeUsage();
      warmSnapshot = next;
      setSnapshot(next);
      setIpcFailed(false);
    } catch (err) {
      silentCatch('monitor:claudeUsage')(err);
      setIpcFailed(true);
    }
  }, []);

  const { lastRefreshed } = usePolling(load, {
    interval: USAGE_POLL_MS,
    enabled,
    name: 'monitor:claudeUsage',
  });

  return { snapshot, ipcFailed, lastRefreshed };
}

/** Test hatch — the warm cache is module state. */
export function _resetClaudeUsageForTests(): void {
  warmSnapshot = null;
}
