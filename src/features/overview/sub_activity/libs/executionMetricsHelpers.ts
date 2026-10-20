import { useI18nStore } from '@/stores/i18nStore';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { DashboardDailyPoint } from '@/lib/bindings/DashboardDailyPoint';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';

const DAY_MS = 24 * 60 * 60 * 1000;
/** YYYY-MM-DD in UTC: the zone the backend buckets `daily_points` in
 *  (`DATE(created_at)` over RFC3339 UTC rows), named rather than implied. */
const UTC_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The selected window's headline figures, measured over THAT window only. */
export interface CurrentWindowSummary {
  totalExecutions: number;
  totalCost: number;
  /** completed / (completed + failed); null when the window decided no run. */
  successRatio: number | null;
  /** Mean run duration; null when this payload cannot measure it for the window. */
  avgLatencyMs: number | null;
  /** Daily points inside the window, oldest first. */
  dailyPoints: DashboardDailyPoint[];
  /** Cost anomalies dated inside the window. */
  anomalies: DashboardCostAnomaly[];
}

/**
 * Cut the execution dashboard down to the window the operator selected.
 *
 * With Compare on, the shared pipeline fetches `2 x effectiveDays` so the
 * prior period can be drawn as ghost lines, and every summary field of that
 * payload (`total_cost`, `total_executions`, `overall_success_rate`,
 * `avg_latency_ms`) is measured over BOTH periods. Reading them straight made
 * the "Total cost" tile double the moment Compare was switched on, under a
 * label naming the single window.
 *
 * The cut is by calendar date, not by point count: the backend emits a point
 * only for a day that had runs, so "the last N points" is not "the last N
 * days" on a sparse series. Dates are UTC (`DATE(created_at)` over RFC3339
 * rows), so the cutoff is computed in UTC too. The mean latency of the cut
 * cannot be derived from daily percentiles, so it is null rather than the
 * double-window figure.
 */
export function summarizeCurrentWindow(
  data: ExecutionDashboardData,
  effectiveDays: number,
  compareEnabled: boolean,
  now: number = Date.now(),
): CurrentWindowSummary {
  if (!compareEnabled) {
    return {
      totalExecutions: data.total_executions,
      totalCost: data.total_cost,
      successRatio: data.total_executions > 0 ? data.overall_success_rate : null,
      avgLatencyMs: data.total_executions > 0 ? data.avg_latency_ms : null,
      dailyPoints: data.daily_points,
      anomalies: data.cost_anomalies,
    };
  }
  const cutoff = UTC_DAY.format(new Date(now - (Math.max(1, effectiveDays) - 1) * DAY_MS));
  const dailyPoints = data.daily_points.filter((p) => p.date >= cutoff);
  let totalExecutions = 0;
  let totalCost = 0;
  let completed = 0;
  let decided = 0;
  for (const p of dailyPoints) {
    totalExecutions += p.total_executions;
    totalCost += p.total_cost;
    completed += p.completed;
    decided += p.completed + p.failed;
  }
  return {
    totalExecutions,
    totalCost,
    successRatio: decided > 0 ? completed / decided : null,
    avgLatencyMs: null,
    dailyPoints,
    anomalies: data.cost_anomalies.filter((a) => a.date >= cutoff),
  };
}

export const fmtCost = (v: number) =>
  v >= 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
export const fmtMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
/** Short month + day in the ACTIVE UI language (read at call time, like formatters.ts). */
export const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(useI18nStore.getState().language, { month: 'short', day: 'numeric' });
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
