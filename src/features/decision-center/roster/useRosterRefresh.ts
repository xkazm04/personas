/**
 * useRosterRefresh — WHEN the roster re-reads, kept apart from WHAT it reads.
 *
 * Three triggers, one coalescing seam:
 *  - a 30 s counts poll on the shared PollingCoordinator (fires on register, so
 *    a mounting roster has numbers at once; paused while the window is hidden);
 *  - a 30 s items tick, only while some chip's items are loaded, which does NOT
 *    fire on register (the sources fetch on mount by themselves);
 *  - five push events, each naming the sources it can have changed, coalesced
 *    for ~1 s so a burst (a team run streaming progress) is one re-read.
 *
 * Every trigger is inert while `enabled` is false.
 */
import { useCallback, useEffect, useRef } from 'react';

import { usePolling } from '@/hooks/utility/timing/usePolling';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { useReportCreatedListener } from '@/hooks/realtime/useReportCreatedListener';
import { getPollingCoordinator } from '@/lib/polling/pollingCoordinator';
import { EventName, type EventPayloadMap } from '@/lib/eventRegistry';

// One native subscription per event, with an early buffer for anything that
// lands before a roster attaches (`snapshot-plus-stream` law (b)) — the
// buffered primitive, not a bare listen per mounted roster.
const useCouncilChanged = createSingletonListener<
  EventPayloadMap[typeof EventName.DEV_TOOLS_COUNCIL_CHANGED]
>(EventName.DEV_TOOLS_COUNCIL_CHANGED);
const useApprovalsCreated = createSingletonListener<
  EventPayloadMap[typeof EventName.COMPANION_APPROVALS]
>(EventName.COMPANION_APPROVALS);
const useChannelMessage = createSingletonListener<
  EventPayloadMap[typeof EventName.PERSONA_CHANNEL_MESSAGE]
>(EventName.PERSONA_CHANNEL_MESSAGE);
const useAssignmentProgress = createSingletonListener<
  EventPayloadMap[typeof EventName.TEAM_ASSIGNMENT_PROGRESS]
>(EventName.TEAM_ASSIGNMENT_PROGRESS);

/** The item sources a refresh can target. */
export type RefreshTarget = 'triage' | 'incidents' | 'reports' | 'council' | 'approvals';

export const ALL_TARGETS: readonly RefreshTarget[] = [
  'triage',
  'incidents',
  'reports',
  'council',
  'approvals',
];

export const ROSTER_POLL_MS = 30_000;
export const EVENT_COALESCE_MS = 1_000;

export interface RosterRefreshHandlers {
  enabled: boolean;
  /** Some chip's items are loaded — the items tick runs only then. */
  itemsActive: boolean;
  /** Re-read the counts. Must not reject. */
  onCounts: () => void;
  /** Re-read these item sources. Inactive ones are the handler's to ignore. */
  onItems: (targets: ReadonlySet<RefreshTarget>) => void;
}

export function useRosterRefresh({
  enabled,
  itemsActive,
  onCounts,
  onItems,
}: RosterRefreshHandlers): void {
  // Read at fire time, so a handler identity change never re-registers a
  // listener or a ticker.
  const latest = useRef({ enabled, onCounts, onItems });
  useEffect(() => {
    latest.current = { enabled, onCounts, onItems };
  }, [enabled, onCounts, onItems]);

  const countsTick = useCallback(() => latest.current.onCounts(), []);
  usePolling(countsTick, { interval: ROSTER_POLL_MS, enabled, name: 'decisionRoster:counts' });

  useEffect(() => {
    if (!enabled || !itemsActive) return;
    const { dispose } = getPollingCoordinator().register(
      'decisionRoster:items',
      () => latest.current.onItems(new Set(ALL_TARGETS)),
      { interval: ROSTER_POLL_MS, fireOnRegister: false },
    );
    return dispose;
  }, [enabled, itemsActive]);

  // Pending targets of the coalescing window; `null` timer = no window open.
  const pending = useRef<Set<RefreshTarget>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  const schedule = useCallback((targets: readonly RefreshTarget[]) => {
    if (!latest.current.enabled) return;
    for (const t of targets) pending.current.add(t);
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const batch = pending.current;
      pending.current = new Set();
      if (!latest.current.enabled) return;
      latest.current.onCounts();
      if (batch.size > 0) latest.current.onItems(batch);
    }, EVENT_COALESCE_MS);
  }, []);

  const onReport = useCallback(() => schedule(['reports']), [schedule]);
  const onCouncil = useCallback(() => schedule(['council']), [schedule]);
  const onApprovals = useCallback(() => schedule(['approvals']), [schedule]);
  // Chat derives from the channel slices, which the channel service already
  // refreshes on this event; only the counts can have moved with it.
  const onChannel = useCallback(() => schedule([]), [schedule]);
  // A held team step raises a review; a finished one parks a goal.
  const onAssignment = useCallback(() => schedule(['triage']), [schedule]);

  useReportCreatedListener(onReport);
  useCouncilChanged(onCouncil);
  useApprovalsCreated(onApprovals);
  useChannelMessage(onChannel);
  useAssignmentProgress(onAssignment);
}
