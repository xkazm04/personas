/**
 * useBadgeCounts — Sidebar badge polling driver.
 *
 * Owns the consolidated sidebar polling (badge counts + budget spend in one
 * tick) and exposes the canonical sidebar-scoped fields drawn from
 * `useAttention("sidebar")`. The unified attention registry is the single
 * source of truth — this hook just wires polling and projects the counts
 * the sidebar cares about.
 *
 * Registers a single ticker on the shared PollingCoordinator's 30s bucket
 * so sidebar refreshes align with other dashboard pollers and SQLite serves
 * them from the same warm cache.
 */

import { useEffect, useCallback, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { POLLING_CONFIG } from "@/hooks/utility/timing/usePolling";
import { useAttention } from "@/hooks/useAttention";
import { getPollingCoordinator } from "@/lib/polling/pollingCoordinator";
import { getDirectorPortfolio } from "@/api/director";
import { flaggedAgentCount } from "@/features/overview/sub_director/attention";

interface BadgeCounts {
  pendingReviewCount: number;
  unreadMessageCount: number;
  pendingEventCount: number;
  directorAttentionCount: number;
}

export function useBadgeCounts(): BadgeCounts {
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);
  const { counts } = useAttention("sidebar");
  // Director attention isn't part of the unified attention registry; poll the
  // portfolio on the same sidebar tick (best-effort) and derive the flagged
  // agent count locally. Empty/no-scope portfolios make this near-free.
  const [directorAttentionCount, setDirectorAttentionCount] = useState(0);

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
    getDirectorPortfolio()
      .then((p) => setDirectorAttentionCount(flaggedAgentCount(p.roster, Date.now())))
      .catch(() => {});
  }, [fetchBudgetSpend]);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void import("@/stores/overviewStore").then(() => {
      if (cancelled) return;
      const handle = getPollingCoordinator().register("sidebarBadges", fetchAll, {
        interval: POLLING_CONFIG.dashboardRefresh.interval,
      });
      dispose = handle.dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [fetchAll]);

  return {
    pendingReviewCount: counts.pending_reviews,
    unreadMessageCount: counts.unread_messages,
    pendingEventCount: counts.pending_events,
    directorAttentionCount,
  };
}
