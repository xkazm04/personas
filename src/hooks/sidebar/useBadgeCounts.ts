/**
 * useBadgeCounts — lightweight hook for Sidebar badge indicators.
 *
 * Dynamically imports the overviewStore to avoid pulling all 7 overview slices
 * (~85 KB) into the main bundle. Badge counts are non-critical UI that can
 * load a frame after the Sidebar shell renders.
 *
 * Also consolidates budget spend polling into the same timer tick so the
 * sidebar runs a single coordinated polling loop instead of two independent
 * timers (badge counts + budget).
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { POLLING_CONFIG } from "@/hooks/utility/timing/usePolling";

interface BadgeCounts {
  pendingReviewCount: number;
  unreadMessageCount: number;
  pendingEventCount: number;
}

const INITIAL: BadgeCounts = { pendingReviewCount: 0, unreadMessageCount: 0, pendingEventCount: 0 };

export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>(INITIAL);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);

  const fetchAll = useCallback(async () => {
    const { useOverviewStore } = await import("@/stores/overviewStore");
    const state = useOverviewStore.getState();
    void state.fetchPendingReviewCount();
    void state.fetchUnreadMessageCount();
    void state.fetchRecentEvents();
    void fetchBudgetSpend();
  }, [fetchBudgetSpend]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      if (cancelled) return;
      // Initial read
      const state = useOverviewStore.getState();
      setCounts({
        pendingReviewCount: state.pendingReviewCount,
        unreadMessageCount: state.unreadMessageCount,
        pendingEventCount: state.pendingEventCount,
      });

      // Fire initial fetches (badge counts + budget in one tick)
      void fetchAll();

      // Single consolidated polling interval for all sidebar data
      timerRef.current = setInterval(fetchAll, POLLING_CONFIG.dashboardRefresh.interval);

      // Subscribe to store changes — only track the 3 badge fields to avoid
      // re-renders when unrelated overview state changes.
      let prev: BadgeCounts = {
        pendingReviewCount: state.pendingReviewCount,
        unreadMessageCount: state.unreadMessageCount,
        pendingEventCount: state.pendingEventCount,
      };
      unsub = useOverviewStore.subscribe((s) => {
        if (
          s.pendingReviewCount !== prev.pendingReviewCount ||
          s.unreadMessageCount !== prev.unreadMessageCount ||
          s.pendingEventCount !== prev.pendingEventCount
        ) {
          const next: BadgeCounts = {
            pendingReviewCount: s.pendingReviewCount,
            unreadMessageCount: s.unreadMessageCount,
            pendingEventCount: s.pendingEventCount,
          };
          prev = next;
          setCounts(next);
        }
      });
    });

    return () => {
      cancelled = true;
      unsub?.();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  return counts;
}
