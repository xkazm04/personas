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

export function resolveMetricPercent(identity: MetricIdentity, values: {
  numerator?: number;
  denominator?: number;
  ratio?: number;
}): number {
  if (identity.kind === 'precomputed_ratio') {
    const ratio = values.ratio ?? 0;
    return Number.isFinite(ratio) ? ratio * 100 : 0;
  }

  const numerator = values.numerator ?? 0;
  const denominator = values.denominator ?? 0;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}
