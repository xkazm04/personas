/**
 * Every word the composed Observability surface shows, from keys the catalog already carries
 * (the kit port adds no strings). Severity and category values are data and render as stored.
 *
 * `region` names the seven layer-1 cards. The surface is two levels since 2026-10-04: the
 * repeated "Overview · Observability" eyebrow every Section carried is gone (the owner, on the
 * long page: "Removing label 'Overview · Observability' from each section"), so nothing here
 * builds one any more - a card's own title is the only label the level needs.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { IssueState } from './issueModel';

/** The layer-1 cards, in the order they sit in the grid. */
export const REGIONS = ['health', 'charts', 'alerts', 'ipc', 'tools', 'traces', 'athena'] as const;
export type RegionId = (typeof REGIONS)[number];

export function useObservabilityWords() {
  const { t, tx, language } = useTranslation();
  return useMemo(() => {
    const o = t.overview;
    const ad = o.analytics_dashboard;
    const state: Record<IssueState, string> = {
      breaker: o.healing_issues_panel.circuit_breaker_label,
      retrying: o.healing_issue_modal.retrying_badge,
      fixed: o.healing_issue_modal.auto_fixed_badge,
      resolved: o.incidents.filter_status_resolved,
      critical: o.health.critical,
      high: o.cockpit.verdict_confidence_high,
      medium: o.cockpit.verdict_confidence_medium,
      low: o.cockpit.verdict_confidence_low,
    };
    const region: Record<RegionId, string> = {
      health: o.healing_issues_panel.title,
      charts: o.activity.metrics,
      alerts: o.observability.alert_rules,
      ipc: o.ipc_panel.title,
      tools: o.widgets.tool_performance,
      traces: o.observability_extra.system_trace,
      athena: o.athena.health_title,
    };
    return {
      t, tx, language, o, ad, state, region,
      source: {
        director: t.director.healing_source_badge,
        oauth: o.healing_issues_panel.oauth_source_badge,
      } as Record<string, string>,
    };
  }, [t, tx, language]);
}

export type ObservabilityWords = ReturnType<typeof useObservabilityWords>;
