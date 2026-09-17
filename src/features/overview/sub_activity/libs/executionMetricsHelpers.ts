import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';

export const fmtCost = (v: number) =>
  v >= 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
export const fmtMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
export const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Adapt a dashboard cost anomaly to the `MetricAnomaly` shape
 * `get_anomaly_drilldown` takes, so the Activity wall can reach the same drill
 * the Observability tab has instead of listing spikes it cannot explain.
 *
 * `deviation_pct` is derived, because the two surfaces measure the same spike
 * on different scales: the dashboard reports sigma (deviation / std_dev) and
 * the drilldown contract wants percent over baseline. A zero moving average
 * has no percentage to report - 0 is the honest answer, not Infinity, and the
 * anomaly's absolute value still travels.
 */
export function costAnomalyToMetricAnomaly(anomaly: {
  date: string;
  cost: number;
  moving_avg: number;
}): MetricAnomaly {
  const deviationPct = anomaly.moving_avg > 0
    ? ((anomaly.cost - anomaly.moving_avg) / anomaly.moving_avg) * 100
    : 0;
  return {
    date: anomaly.date,
    metric: 'cost',
    value: anomaly.cost,
    baseline: anomaly.moving_avg,
    deviation_pct: deviationPct,
    // The dashboard anomaly carries a LIST of costliest executions; the
    // drilldown contract has room for one and uses it only as a hint, so
    // sending an arbitrary member of the list would be inventing an
    // attribution the row does not make.
    execution_id: null,
  };
}
