// useCliUsage — the passive read of the OTHER coding CLIs (Codex, Grok).
//
// Same shape as `useClaudeUsage`, for the same reason: the Monitor is an overlay
// that fully unmounts on close, so the last snapshot lives in the module with
// its stamp — a remount inside the five-minute window paints it and asks the
// backend nothing, and the poll runs on that cadence.
//
// IT NEVER THROWS INTO RENDER, AND IT NEVER INVENTS A NUMBER. The command is
// designed to resolve with one card per provider whatever happens; if the IPC
// itself rejects, every provider becomes `unreadable` — a card state with its
// own copy — rather than an error boundary or an empty strip. A warm snapshot
// survives a failed re-read: the last honest numbers, still stamped with when
// they were true, beat a wall of "unreadable".
//
// SIMULATION replaces the read outright (`buildSimCliUsage`), so the Codex and
// Grok rows can be judged without a backend or an installed Codex.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { silentCatch } from '@/lib/silentCatch';
import { getCliUsage } from '@/api/fleet/cliUsage';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';
import { USAGE_CACHE_MS } from '../useClaudeUsage';
import { buildSimCliUsage } from '../simulation';
import { unreadableCliUsage } from './cliProviders';

// Single-slot warm copy (one machine, one snapshot) — see the header.
let warmSnapshot: CliUsageSnapshot | null = null;
let warmAt: number | null = null;

export interface CliUsageState {
  /** Null only before the first read settles. */
  snapshot: CliUsageSnapshot | null;
  fetchedAt: number | null;
  refresh: () => Promise<void>;
}

export function useCliUsage(enabled: boolean, simulated = false): CliUsageState {
  const [snapshot, setSnapshot] = useState<CliUsageSnapshot | null>(warmSnapshot);
  const [fetchedAt, setFetchedAt] = useState<number | null>(warmAt);
  const live = enabled && !simulated;

  const read = useCallback(async (force: boolean) => {
    if (!force && warmAt !== null && Date.now() - warmAt < USAGE_CACHE_MS) {
      setSnapshot(warmSnapshot);
      setFetchedAt(warmAt);
      return;
    }
    try {
      const next = await getCliUsage();
      warmSnapshot = next;
      warmAt = Date.now();
      setSnapshot(next);
      setFetchedAt(warmAt);
    } catch (err) {
      silentCatch('monitor:cliUsage')(err);
      // Not cached: the next poll should try again rather than serve this.
      setSnapshot((prev) => prev ?? unreadableCliUsage());
    }
  }, []);

  const poll = useCallback(() => read(false), [read]);
  usePolling(poll, { interval: USAGE_CACHE_MS, enabled: live, name: 'monitor:cliUsage' });
  useEffect(() => {
    if (live) void read(false);
  }, [live, read]);

  const refresh = useCallback(() => (live ? read(true) : Promise.resolve()), [live, read]);
  const sim = useMemo(() => (simulated ? buildSimCliUsage() : null), [simulated]);

  return simulated
    ? { snapshot: sim, fetchedAt: null, refresh }
    : { snapshot, fetchedAt, refresh };
}

/** Test hatch — the warm copy is module state. */
export function _resetCliUsageForTests(): void {
  warmSnapshot = null;
  warmAt = null;
}
