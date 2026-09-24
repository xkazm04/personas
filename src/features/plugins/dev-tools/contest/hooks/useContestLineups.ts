// Saved seat line-ups (app setting `contest.lineups`), read and replaced
// whole — the list is small and the backend stores it as one JSON array.
import { useCallback, useEffect } from 'react';

import { setContestLineups } from '@/api/contest';
import { useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import type { ContestLineup } from '@/lib/bindings/ContestLineup';

import { contestLineupSlots, emptySlot, primeLineups, refreshLineups } from './contestStore';

export interface ContestLineupsState {
  lineups: ContestLineup[];
  isLoading: boolean;
  error: unknown;
  /** Replace every saved line-up; rejects on failure (the caller's control
   *  owns the busy state and the toast). */
  save: (lineups: ContestLineup[]) => Promise<void>;
  /** Add or replace (by name) one line-up. */
  upsert: (lineup: ContestLineup) => Promise<void>;
  /** Remove one line-up by name. */
  remove: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useContestLineups(): ContestLineupsState {
  const slot = useModuleSubscription(contestLineupSlots, 'all') ?? emptySlot<ContestLineup[]>();
  const lineups = slot.data ?? [];

  useEffect(() => {
    void refreshLineups();
  }, []);

  const save = useCallback(async (next: ContestLineup[]) => {
    await setContestLineups(next);
    primeLineups(next);
  }, []);

  const upsert = useCallback(
    async (lineup: ContestLineup) => {
      const rest = (contestLineupSlots.get('all')?.data ?? []).filter((l) => l.name !== lineup.name);
      await save([...rest, lineup]);
    },
    [save],
  );

  const remove = useCallback(
    async (name: string) => {
      await save((contestLineupSlots.get('all')?.data ?? []).filter((l) => l.name !== name));
    },
    [save],
  );

  return {
    lineups,
    isLoading: slot.data === null && slot.error === null,
    error: slot.error,
    save,
    upsert,
    remove,
    refresh: refreshLineups,
  };
}
