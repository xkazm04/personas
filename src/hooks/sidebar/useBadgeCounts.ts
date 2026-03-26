/**
 * useBadgeCounts — lightweight hook for Sidebar badge indicators.
 *
 * Dynamically imports the overviewStore to avoid pulling all 7 overview slices
 * (~85 KB) into the main bundle. Badge counts are non-critical UI that can
 * load a frame after the Sidebar shell renders.
 */

import { useEffect, useState } from "react";

interface BadgeCounts {
  pendingReviewCount: number;
  unreadMessageCount: number;
  pendingEventCount: number;
}

const INITIAL: BadgeCounts = { pendingReviewCount: 0, unreadMessageCount: 0, pendingEventCount: 0 };

export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>(INITIAL);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      // Initial read
      const state = useOverviewStore.getState();
      setCounts({
        pendingReviewCount: state.pendingReviewCount,
        unreadMessageCount: state.unreadMessageCount,
        pendingEventCount: state.pendingEventCount,
      });

      // Fire initial fetches
      void state.fetchPendingReviewCount();
      void state.fetchUnreadMessageCount();
      void state.fetchRecentEvents();

      // Subscribe only to the 3 badge fields with shallow equality
      const selector = (s: { pendingReviewCount: number; unreadMessageCount: number; pendingEventCount: number }): BadgeCounts => ({
        pendingReviewCount: s.pendingReviewCount,
        unreadMessageCount: s.unreadMessageCount,
        pendingEventCount: s.pendingEventCount,
      });
      unsub = useOverviewStore.subscribe(selector, setCounts, {
        equalityFn: (a, b) =>
          a.pendingReviewCount === b.pendingReviewCount &&
          a.unreadMessageCount === b.unreadMessageCount &&
          a.pendingEventCount === b.pendingEventCount,
      });
    });

    return () => unsub?.();
  }, []);

  return counts;
}
