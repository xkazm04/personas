// Data hooks for the Contest page. All state lives in `contestStore.ts`
// (module-scoped, warm across remounts); these hooks subscribe, trigger the
// first fetch, and refetch on `contest-changed`.
import { useCallback, useEffect } from 'react';

import { useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import type { ContestChangedPayload } from '@/lib/bindings/ContestChangedPayload';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestEnvironment } from '@/lib/bindings/ContestEnvironment';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import {
  contestDetailSlots,
  contestEnvSlots,
  contestListSlots,
  detailKey,
  emptySlot,
  refreshContest,
  refreshContests,
  refreshEnvironment,
} from './contestStore';
import { useContestChanged } from './contestEvents';

export interface ContestsState {
  /** Every contest, newest first as the backend sorts them. Empty until the
   *  first fetch settles — read `isLoading`/`error` before calling it empty. */
  contests: ContestSummary[];
  /** True only while nothing has loaded yet (a cold ghost, never a spinner). */
  isLoading: boolean;
  /** The raw failure of the last fetch; resolve it at render. */
  error: unknown;
  refresh: () => Promise<void>;
}

/** Every contest across every managed project. */
export function useContests(): ContestsState {
  const slot = useModuleSubscription(contestListSlots, 'all') ?? emptySlot<ContestSummary[]>();

  useEffect(() => {
    void refreshContests();
  }, []);

  useContestChanged(() => {
    void refreshContests();
  });

  return {
    contests: slot.data ?? [],
    isLoading: slot.data === null && slot.error === null,
    error: slot.error,
    refresh: refreshContests,
  };
}

export interface ContestState {
  detail: ContestDetail | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

/** One contest in full; refetches when its own `contest-changed` arrives.
 *  Pass nulls for "nothing focused" — the hook then idles. */
export function useContest(projectId: string | null, contestId: string | null): ContestState {
  const key = projectId && contestId ? detailKey(projectId, contestId) : '';
  const slot = useModuleSubscription(contestDetailSlots, key) ?? emptySlot<ContestDetail>();

  const refresh = useCallback(async () => {
    if (projectId && contestId) await refreshContest(projectId, contestId);
  }, [projectId, contestId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useContestChanged((p: ContestChangedPayload) => {
    if (p.projectId === projectId && p.contestId === contestId) void refresh();
  });

  return {
    detail: key ? slot.data : null,
    isLoading: !!key && slot.data === null && slot.error === null,
    error: key ? slot.error : null,
    refresh,
  };
}

export interface ContestEnvironmentState {
  environment: ContestEnvironment | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

/** What the project is missing to run a contest (node, instrument, CLIs,
 *  Playwright). Not event-driven: the operator installs something, then asks
 *  again through `refresh`. */
export function useContestEnvironment(projectId: string | null): ContestEnvironmentState {
  const key = projectId ?? '';
  const slot = useModuleSubscription(contestEnvSlots, key) ?? emptySlot<ContestEnvironment>();

  const refresh = useCallback(async () => {
    if (projectId) await refreshEnvironment(projectId);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    environment: key ? slot.data : null,
    isLoading: !!key && slot.data === null && slot.error === null,
    error: key ? slot.error : null,
    refresh,
  };
}
