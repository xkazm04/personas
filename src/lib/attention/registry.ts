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
 * count from `OverviewStore`. UI code does not change.
 */

import type { OverviewStore } from "@/stores/storeTypes";
import { selectActiveAlertCount } from "@/stores/selectors/activeAlertCount";

/**
 * Stable identifiers for every attention-bearing domain. Keep this list
 * narrow — attention is "items the user can act on now", not generic counters.
 */
export type AttentionDomainId =
  | "pending_reviews"
  | "unread_messages"
  | "active_alerts"
  | "memory_actions"
  | "pending_events";

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
  /** Derive the count from the overview store snapshot. */
  count: (s: OverviewStore) => number;
}

const REGISTRY: AttentionDomain[] = [
  {
    id: "pending_reviews",
    labelKey: "pending_reviews",
    scopes: ["sidebar", "dashboard", "overview"],
    count: (s: OverviewStore) => s.pendingReviewCount,
  },
  {
    id: "unread_messages",
    labelKey: "unread_messages",
    scopes: ["sidebar", "dashboard", "overview"],
    count: (s: OverviewStore) => s.unreadMessageCount,
  },
  {
    id: "active_alerts",
    labelKey: "active_alerts",
    scopes: ["dashboard", "observability"],
    count: selectActiveAlertCount,
  },
  {
    id: "memory_actions",
    labelKey: "memory_actions",
    scopes: ["dashboard"],
    count: (s: OverviewStore) => s.memoryActions.length,
  },
  {
    id: "pending_events",
    labelKey: "pending_events",
    scopes: ["sidebar"],
    count: (s: OverviewStore) => s.pendingEventCount,
  },
];

export const ATTENTION_REGISTRY: readonly AttentionDomain[] = Object.freeze(REGISTRY);

/** Filter the registry to a given scope. */
export function attentionDomainsForScope(scope: AttentionScope): readonly AttentionDomain[] {
  return ATTENTION_REGISTRY.filter((d) => d.scopes.includes(scope));
}
