import { useMemo } from 'react';
import { MONITOR_REVIEW_LIMIT, useMonitorData } from '../useMonitorData';
import { buildMonitorModel } from '../monitorModel';

/**
 * The Monitor's data engine, gated by the destination on screen, and the card
 * model the Activity board draws from it.
 *
 * WHICH FEEDS THIS VIEW ACTUALLY RENDERS.
 *
 * The header destinations are PEERS, and only Activity draws anything built
 * out of `reviews` / `unreadMessages` / `healthMap`: the grid cards, the drawer
 * over them, and the system band. Conversations, the Blueprint and the Map
 * draw their own surfaces and nothing else.
 *
 * This block used to read "all four feeds stay ON regardless of the active
 * view — deliberately", and justified it by "the footer's review count and the
 * header's attention badges render in every view". That footer no longer
 * exists: the legend + count line was replaced by `QuickDispatchDock`, and the
 * header router carries no badges. The justification outlived the pixels it
 * pointed at, so the three polls kept running for a model with nothing behind
 * it — `list_manual_reviews`, `list_reports(300)` and `get_persona_summaries`,
 * measured at 3 calls each per 60s on the live app through the :17320 perf
 * bridge.
 *
 * Its OTHER argument was real and is preserved: gating must not make a tab
 * switch feel like a cold load. It does not. The hook keeps its state across
 * the flag change, so returning to Activity paints the last-known fleet
 * immediately; `usePolling` fires a ticker the moment it re-registers, so the
 * refresh is instant rather than a cadence away; and the mount-time reads are
 * not gated at all, so `loading` still resolves on a Monitor that opens
 * straight into another tab. Nothing here is remembered longer than it is true.
 *
 * `isFleetView` is Activity: it draws cards built from these feeds and hosts
 * the persona drawer. (It was `activity || board` until the Board was deleted
 * on 2026-10-06; the name stays because the distinction it draws — fleet reads
 * vs the other surfaces — is still the one the feeds gate on.)
 */
export function useMonitorFeeds(isFleetView: boolean) {
  const feeds = useMemo(
    () => ({
      reviews: isFleetView,
      messages: isFleetView,
      personaHealth: isFleetView,
      badgeCounts: true,
      // The rail's triage queue now reads THIS engine (see `monitorDataContext`),
      // and it needs rows, not just a count. Composing the two here is what
      // makes one engine able to serve both; see `MONITOR_REVIEW_LIMIT`.
      reviewLimit: MONITOR_REVIEW_LIMIT,
    }),
    [isFleetView],
  );
  // The whole object is returned (not just destructured fields) because it is
  // published to the subtree through `MonitorDataProvider`, and a provider
  // cannot read the context it publishes.
  const monitorData = useMonitorData(feeds);
  const {
    personas, reviews, unreadMessages, activeProcesses, healthMap,
    reviewBadgeCounts, messageBadgeCounts,
  } = monitorData;
  const { cards, systemProcesses } = useMemo(
    () => buildMonitorModel(personas, reviews, unreadMessages, activeProcesses, healthMap, {
      reviews: reviewBadgeCounts,
      messages: messageBadgeCounts,
    }),
    [personas, reviews, unreadMessages, activeProcesses, healthMap, reviewBadgeCounts, messageBadgeCounts],
  );
  return { monitorData, cards, systemProcesses };
}
