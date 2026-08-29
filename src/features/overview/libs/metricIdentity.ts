export interface MetricIdentity {
  id: string;
  label: string;
  source: string;
  timeWindow: string;
  kind: 'ratio' | 'precomputed_ratio';
  numeratorField?: string;
  denominatorField?: string;
  valueField?: string;
}

export const SUCCESS_RATE_IDENTITIES = {
  dashboardRecentExecutions: {
    id: 'success-rate.dashboard.recent-executions',
    label: 'Success Rate',
    source: 'globalExecutions',
    timeWindow: 'recent-50-or-filtered',
    kind: 'ratio',
    numeratorField: 'completed',
    denominatorField: 'executions',
  } satisfies MetricIdentity,

  analyticsSummary: {
    id: 'success-rate.analytics.summary',
    label: 'Success Rate',
    source: 'observability.summary',
    timeWindow: 'selected-day-range',
    kind: 'ratio',
    numeratorField: 'successful_executions',
    denominatorField: 'total_executions',
  } satisfies MetricIdentity,

  executionDashboardSummary: {
    id: 'success-rate.executions.summary',
    label: 'Success Rate',
    source: 'executionDashboard',
    timeWindow: 'selected-time-window',
    kind: 'precomputed_ratio',
    valueField: 'overall_success_rate',
  } satisfies MetricIdentity,
} as const;

/**
 * Resolve a metric to a percentage, or to `null` when it was not measured.
 *
 * `null` is not a defensive nicety, it is the contract. An empty denominator
 * means nothing ran in the window, and a fleet that executed nothing did not
 * have a 0% success rate — it had no success rate. Returning 0 for it decides
 * "not measured" is "measured, zero" here, at the derivation, before any chart
 * or tile gets a vote, and 0% on a success-rate tile is not a neutral value:
 * it reads as a total outage. The same applies to a non-finite ratio, which is
 * an unreadable input rather than a floor.
 *
 * Callers must render an absent metric as a neutral mark (a dash), never as 0
 * and never as a vanished tile.
 */
export function resolveMetricPercent(identity: MetricIdentity, values: {
  numerator?: number;
  denominator?: number;
  ratio?: number;
}): number | null {
  if (identity.kind === 'precomputed_ratio') {
    const ratio = values.ratio;
    if (ratio === undefined || !Number.isFinite(ratio)) return null;
    return ratio * 100;
  }

  const numerator = values.numerator ?? 0;
  const denominator = values.denominator ?? 0;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}
