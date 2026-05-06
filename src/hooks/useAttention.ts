/**
 * useAttention — unified accessor for cross-domain "attention" counts.
 *
 * Subscribes to the overview store and returns counts for every domain in
 * `ATTENTION_REGISTRY`, optionally narrowed to a scope (sidebar, dashboard,
 * etc.). Replaces the prior pattern where each surface (Sidebar,
 * DashboardHeaderBadges, tab indicators, ObservabilityDashboard) reached into
 * the store independently and drifted out of sync with each other.
 *
 * Returns:
 *  - `counts[id]`: number for every registered domain
 *  - `total`:      sum of counts in the requested scope
 *  - `domains`:    registry entries for the requested scope (handy when
 *                  rendering a list of badges)
 */

import { useShallow } from "zustand/react/shallow";
import { useOverviewStore } from "@/stores/overviewStore";
import {
  ATTENTION_REGISTRY,
  attentionDomainsForScope,
  type AttentionDomain,
  type AttentionDomainId,
  type AttentionScope,
} from "@/lib/attention/registry";

export type AttentionCounts = Record<AttentionDomainId, number>;

export interface UseAttentionResult {
  counts: AttentionCounts;
  total: number;
  domains: readonly AttentionDomain[];
}

export function useAttention(scope?: AttentionScope): UseAttentionResult {
  const counts = useOverviewStore(
    useShallow((s) => {
      const out = {} as AttentionCounts;
      for (const domain of ATTENTION_REGISTRY) {
        out[domain.id] = domain.count(s);
      }
      return out;
    }),
  );

  const domains = scope ? attentionDomainsForScope(scope) : ATTENTION_REGISTRY;
  let total = 0;
  for (const d of domains) total += counts[d.id];

  return { counts, total, domains };
}
