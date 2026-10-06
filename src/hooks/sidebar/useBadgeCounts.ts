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
 *
 * The DECISION counts (pending reviews, unread reports, open incidents) are not
 * read here any more. They come from the Decision Center roster's one
 * `dev_tools_pending_counts` read (`systemStore.pendingCounts`), which the
 * title-bar badge keeps fresh on the same 30 s bucket, and the attention
 * registry derives them from it — so the sidebar, the badge and the hub strip
 * read one answer. This ticker used to issue `get_pending_review_count` and
 * `get_unread_report_count` of its own: the same SQL as two of the roster's
 * counts, read at a different moment.
 */

import { useEffect, useCallback, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { PendingCounts } from "@/lib/bindings/PendingCounts";
import { POLLING_CONFIG } from "@/hooks/utility/timing/usePolling";
import { useAttention } from "@/hooks/useAttention";
import { getPollingCoordinator } from "@/lib/polling/pollingCoordinator";
import { getDirectorPortfolio } from "@/api/director";
import { flaggedAgentCount } from "@/features/companions/overseer/attention";
import { silentCatch } from "@/lib/silentCatch";

interface BadgeCounts {
  pendingReviewCount: number;
  unreadReportCount: number;
  pendingEventCount: number;
  directorAttentionCount: number;
  /** Non-terminal incidents — the roster's incidents chip. */
  openIncidentCount: number;
}

/**
 * Keep the overview store's two legacy count fields on the roster's read.
 *
 * Nothing polls them any more, and two readers still read them directly (the
 * Home "since you left" briefing, the title bar's monitor badge). Mirroring
 * the one read into them keeps those readers moving with the sidebar instead
 * of freezing at whatever the last per-field read said.
 */
function mirrorDecisionCounts(
  pending: PendingCounts | null,
  overview: { getState: () => { pendingReviewCount: number; unreadReportCount: number }; setState: (p: { pendingReviewCount: number; unreadReportCount: number }) => void },
): void {
  if (!pending) return;
  const o = overview.getState();
  if (o.pendingReviewCount === pending.manualReviews && o.unreadReportCount === pending.unreadReports) return;
  overview.setState({ pendingReviewCount: pending.manualReviews, unreadReportCount: pending.unreadReports });
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
    state.fetchRecentEvents().catch(silentCatch('hooks/sidebar/useBadgeCounts:fetchRecentEvents'));
    fetchBudgetSpend().catch(silentCatch('hooks/sidebar/useBadgeCounts:fetchBudgetSpend'));
    getDirectorPortfolio()
      .then((p) => setDirectorAttentionCount(flaggedAgentCount(p.roster, Date.now())))
      .catch(silentCatch('hooks/sidebar/useBadgeCounts:getDirectorPortfolio'));
  }, [fetchBudgetSpend]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      if (cancelled) return;
      mirrorDecisionCounts(useSystemStore.getState().pendingCounts, useOverviewStore);
      unsubscribe = useSystemStore.subscribe((s, prev) => {
        if (s.pendingCounts !== prev.pendingCounts) mirrorDecisionCounts(s.pendingCounts, useOverviewStore);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

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
    unreadReportCount: counts.unread_reports,
    pendingEventCount: counts.pending_events,
    directorAttentionCount,
    openIncidentCount: counts.open_incidents,
  };
}
