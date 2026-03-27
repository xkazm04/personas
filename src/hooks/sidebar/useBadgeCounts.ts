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

      // Subscribe to store changes and update only when badge fields change
      let prev = { ...state } as { pendingReviewCount: number; unreadMessageCount: number; pendingEventCount: number };
      unsub = useOverviewStore.subscribe((s) => {
        if (
          s.pendingReviewCount !== prev.pendingReviewCount ||
          s.unreadMessageCount !== prev.unreadMessageCount ||
          s.pendingEventCount !== prev.pendingEventCount
        ) {
          prev = s;
          setCounts({
            pendingReviewCount: s.pendingReviewCount,
            unreadMessageCount: s.unreadMessageCount,
            pendingEventCount: s.pendingEventCount,
          });
        }
      });
    });

    return () => unsub?.();
  }, []);

  return counts;
}
