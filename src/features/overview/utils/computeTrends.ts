// -- Period-over-Period Trend Computation ----------------------------------
// Splits a double-period chart data array into current and previous halves,
// then computes percentage change for key metrics.

export interface TrendValue {
  /** Absolute percentage change (always >= 0) */
  pctChange: number;
  /** Direction of the change */
  direction: 'up' | 'down' | 'stable';
}

export interface MetricTrends {
  cost: TrendValue | null;
  executions: TrendValue | null;
  successRate: TrendValue | null;
  latency: TrendValue | null;
}

/** Threshold below which a change is considered "stable" */
const STABLE_THRESHOLD_PCT = 1;

function sumField(arr: Array<Record<string, string | number>>, key: string): number {
  return arr.reduce((sum, pt) => {
    const v = pt[key];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);
}

function avgField(arr: Array<Record<string, string | number>>, key: string): number {
  const nums = arr.filter((pt) => typeof pt[key] === 'number');
  if (nums.length === 0) return 0;
  return nums.reduce((sum, pt) => sum + (pt[key] as number), 0) / nums.length;
}

function makeTrend(current: number, previous: number): TrendValue {
  if (previous === 0 && current === 0) return { pctChange: 0, direction: 'stable' };
  if (previous === 0) return { pctChange: 100, direction: 'up' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < STABLE_THRESHOLD_PCT) return { pctChange: 0, direction: 'stable' };
  return { pctChange: Math.abs(pct), direction: pct > 0 ? 'up' : 'down' };
}

/**
 * Compute trend indicators from a double-period chart data array.
 *
 * @param chartData     Full chart data array (2x period when compare is enabled)
 * @param effectiveDays Number of days in the current period
 * @param compareEnabled Whether period comparison is active
 */
export function computePeriodTrends(
  chartData: Array<Record<string, string | number>>,
  effectiveDays: number,
  compareEnabled: boolean,
): MetricTrends | null {
  if (!compareEnabled || chartData.length === 0) return null;

  const splitIdx = Math.max(0, chartData.length - effectiveDays);
  const prev = chartData.slice(0, splitIdx);
  const curr = chartData.slice(splitIdx);

  if (prev.length === 0) return null;

  return {
    cost: makeTrend(sumField(curr, 'cost'), sumField(prev, 'cost')),
    executions: makeTrend(sumField(curr, 'executions'), sumField(prev, 'executions')),
    successRate: makeTrend(avgField(curr, 'successRate'), avgField(prev, 'successRate')),
    latency: makeTrend(avgField(curr, 'p50'), avgField(prev, 'p50')),
  };
}
