/**
 * Every word the composed Observability surface shows, from keys the catalog already carries
 * (the kit port adds no strings). Severity and category values are data and render as stored.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { IssueState } from './issueModel';

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
    return {
      t, tx, language, o, ad, state,
      eyebrow: `${o.title} · ${o.observability.title}`,
      healingEyebrow: `${o.observability.title} · ${o.healing_issues_panel.title}`,
      source: {
        director: t.director.healing_source_badge,
        oauth: o.healing_issues_panel.oauth_source_badge,
      } as Record<string, string>,
    };
  }, [t, tx, language]);
}

export type ObservabilityWords = ReturnType<typeof useObservabilityWords>;
