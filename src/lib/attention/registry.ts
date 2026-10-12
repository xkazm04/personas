/**
 * Attention registry — single source of truth for "items that need user attention"
 * across the app (pending reviews, unread messages, active alerts, memory actions,
 * pending events, ...).
 *
 * Every domain that exposes an "attention count" must register here. Sidebar
 * badges, dashboard headers, tab indicators, and any other consumer reads
 * counts via `useAttention()` rather than wiring up its own selector — this
 * eliminates the historical drift between sidebar and dashboard counts that
 * came from each surface fetching independently at different cadences.
 *
 * Adding a new domain = adding one entry here + a predicate that derives the
 * count from {@link AttentionSources}. UI code does not change.
 *
 * DECISION COUNTS COME FROM THE ROSTER'S READ. Pending reviews, unread reports
 * and open incidents are three of the Decision Center's chips, and the roster
 * reads all of them in one `dev_tools_pending_counts` round-trip
 * (`PendingCounts`, held in the system store). The sidebar used to read the
 * first two through two more commands of its own on its own tick — the same
 * SQL, read at a different moment, so the sidebar and the hub strip could show
 * different numbers for the same queue for up to a poll. They derive from
 * `PendingCounts` now, and fall back to the overview store's legacy fields only
 * until the first counts read lands.
 */

import type { PendingCounts } from "@/lib/bindings/PendingCounts";
import type { OverviewStore } from "@/stores/storeTypes";
import { selectActiveAlertCount } from "@/stores/selectors/activeAlertCount";

/**
 * Stable identifiers for every attention-bearing domain. Keep this list
 * narrow — attention is "items the user can act on now", not generic counters.
 */
export type AttentionDomainId =
  | "pending_reviews"
  | "unread_reports"
  | "active_alerts"
  | "memory_actions"
  | "pending_events"
  | "open_incidents";

/**
 * Where this domain's attention surfaces. Multiple scopes are allowed; the
 * sidebar reads the union, the dashboard chooses what to show, etc.
 */
export type AttentionScope = "sidebar" | "dashboard" | "overview" | "observability";

export interface AttentionDomain {
  /** Stable identifier — used as React keys and aria identifiers. */
  id: AttentionDomainId;
  /** i18n key path under `t.attention.<key>` for the human label. */
  labelKey: AttentionDomainId;
  /** Where this count is allowed to surface. */
  scopes: AttentionScope[];
  /** Derive the count from the sources snapshot. */
  count: (s: AttentionSources) => number;
}

/** What a domain's count may read. */
export interface AttentionSources {
  overview: OverviewStore;
  /** The Decision Center roster's counts read; null until the first one lands. */
  pending: PendingCounts | null;
}

const REGISTRY: AttentionDomain[] = [
  {
    id: "pending_reviews",
    labelKey: "pending_reviews",
    scopes: ["sidebar", "dashboard", "overview"],
    count: (s) => s.pending?.manualReviews ?? s.overview.pendingReviewCount,
  },
  {
    id: "unread_reports",
    labelKey: "unread_reports",
    scopes: ["sidebar", "dashboard", "overview"],
    count: (s) => s.pending?.unreadReports ?? s.overview.unreadReportCount,
  },
  {
    id: "active_alerts",
    labelKey: "active_alerts",
    scopes: ["dashboard", "observability"],
    count: (s) => selectActiveAlertCount(s.overview),
  },
  {
    id: "memory_actions",
    labelKey: "memory_actions",
    scopes: ["dashboard"],
    count: (s) => s.overview.memoryActions.length,
  },
  {
    id: "pending_events",
    labelKey: "pending_events",
    scopes: ["sidebar"],
    count: (s) => s.overview.pendingEventCount,
  },
  {
    // Every non-terminal incident (open | acknowledged | in_progress) — the
    // roster's incidents chip. Badges Overview › Incidents.
    id: "open_incidents",
    labelKey: "open_incidents",
    scopes: ["sidebar"],
    count: (s) => s.pending?.openIncidents ?? 0,
  },
];

export const ATTENTION_REGISTRY: readonly AttentionDomain[] = Object.freeze(REGISTRY);

/** Filter the registry to a given scope. */
export function attentionDomainsForScope(scope: AttentionScope): readonly AttentionDomain[] {
  return ATTENTION_REGISTRY.filter((d) => d.scopes.includes(scope));
}
