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
      let prev = { pendingReviewCount: state.pendingReviewCount, unreadMessageCount: state.unreadMessageCount, pendingEventCount: state.pendingEventCount };
      unsub = useOverviewStore.subscribe((s) => {
        const next = { pendingReviewCount: s.pendingReviewCount, unreadMessageCount: s.unreadMessageCount, pendingEventCount: s.pendingEventCount };
        if (next.pendingReviewCount !== prev.pendingReviewCount || next.unreadMessageCount !== prev.unreadMessageCount || next.pendingEventCount !== prev.pendingEventCount) {
          prev = next;
          setCounts(next);
        }
      });
    });

    return () => unsub?.();
  }, []);

  return counts;
}
