/**
 * useLanesSnapshot — the shared lanes snapshot, live.
 *
 * Reads `lanesSnapshotSource` and, while `enabled`, keeps it fresh: one read
 * on mount, one per `charter-act-recorded` (a steward or the operator acted,
 * so an item may have changed lane). The 30 s tick and the roster's own push
 * events reach it through `useDecisionCountsCore.refreshCounts`.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { EventName, type EventPayloadMap } from '@/lib/eventRegistry';

import {
  getLanesSnapshotState,
  refreshLanesSnapshot,
  subscribeLanesSnapshot,
  type LanesSnapshotState,
} from './lanesSnapshotSource';

/** One native subscription to the act stream, shared by every reader. */
export const useCharterActRecorded = createSingletonListener<
  EventPayloadMap[typeof EventName.CHARTER_ACT_RECORDED]
>(EventName.CHARTER_ACT_RECORDED);

export function useLanesSnapshot(enabled: boolean): LanesSnapshotState {
  const state = useSyncExternalStore(subscribeLanesSnapshot, getLanesSnapshotState);
  useEffect(() => {
    if (enabled) void refreshLanesSnapshot();
  }, [enabled]);
  const onAct = useCallback(() => {
    if (enabled) void refreshLanesSnapshot();
  }, [enabled]);
  useCharterActRecorded(onAct);
  return state;
}
