/**
 * useBadgeCounts — Sidebar badge polling driver.
 *
 * Owns the consolidated polling timer (badge counts + budget spend in one
 * tick) and exposes the canonical sidebar-scoped fields drawn from
 * `useAttention("sidebar")`. The unified attention registry is the single
 * source of truth — this hook just wires polling and projects the counts
 * the sidebar cares about.
 *
 * Dynamically imports the overviewStore to avoid pulling all overview slices
 * into the main bundle on first paint.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { POLLING_CONFIG } from "@/hooks/utility/timing/usePolling";
import { useAttention } from "@/hooks/useAttention";

interface BadgeCounts {
  pendingReviewCount: number;
  unreadMessageCount: number;
  pendingEventCount: number;
}

export function useBadgeCounts(): BadgeCounts {
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);
  const { counts } = useAttention("sidebar");

  const fetchAll = useCallback(async () => {
    const { useOverviewStore } = await import("@/stores/overviewStore");
    const state = useOverviewStore.getState();
    // Stagger fetches across frames to avoid a burst of simultaneous
    // set() calls that cause cascading React re-renders in one frame.
    await state.fetchPendingReviewCount();
    state.fetchUnreadMessageCount().catch(() => {});
    await new Promise(r => setTimeout(r, 0)); // yield to browser
    state.fetchRecentEvents().catch(() => {});
    fetchBudgetSpend().catch(() => {});
  }, [fetchBudgetSpend]);

  useEffect(() => {
    let cancelled = false;
    void import("@/stores/overviewStore").then(() => {
      if (cancelled) return;
      // Fire initial fetches (badge counts + budget in one tick)
      void fetchAll();
      timerRef.current = setInterval(fetchAll, POLLING_CONFIG.dashboardRefresh.interval);
    });
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  return {
    pendingReviewCount: counts.pending_reviews,
    unreadMessageCount: counts.unread_messages,
    pendingEventCount: counts.pending_events,
  };
}
