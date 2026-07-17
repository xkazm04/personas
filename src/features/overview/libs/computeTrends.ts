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

/**
 * The single source of period-over-period splitting used across Overview.
 *
 * A genuine prior-period comparison requires the series to actually span TWO
 * periods (fetched at `2 × currentPeriodDays` — the pipeline does this only
 * when `compareEnabled`). This helper enforces that invariant: it returns
 * `null` unless comparison is active AND there is a non-empty prior half to
 * compare against. Callers must therefore render NO trend rather than fabricate
 * one from a single loaded window (the front-half/back-half heuristic that used
 * to lie on the Home "Runs" tile).
 *
 * @param rows              Series covering up to `2 × currentPeriodDays` points.
 * @param currentPeriodDays Days in the current period (the latter half).
 * @param compareEnabled    Whether the 2×-window comparison fetch is active.
 */
export function splitComparisonPeriods<T>(
  rows: T[],
  currentPeriodDays: number,
  compareEnabled: boolean,
): { previous: T[]; current: T[] } | null {
  if (!compareEnabled || rows.length === 0) return null;
  const splitIdx = Math.max(0, rows.length - currentPeriodDays);
  const previous = rows.slice(0, splitIdx);
  const current = rows.slice(splitIdx);
  if (previous.length === 0) return null;
  return { previous, current };
}

/**
 * Signed period-over-period percentage change for a plain numeric series,
 * built on {@link splitComparisonPeriods}. Returns `null` when no genuine prior
 * period is loaded, or when the prior period summed to zero (no baseline).
 * A positive result means the current period is higher than the prior one.
 */
export function computeSeriesTrendPct(
  values: number[],
  currentPeriodDays: number,
  compareEnabled: boolean,
): number | null {
  const split = splitComparisonPeriods(values, currentPeriodDays, compareEnabled);
  if (!split) return null;
  const prevSum = split.previous.reduce((s, v) => s + v, 0);
  const currSum = split.current.reduce((s, v) => s + v, 0);
  if (prevSum === 0) return null;
  return ((currSum - prevSum) / prevSum) * 100;
}

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

function makeTrend(current: number, previous: number, isAverage = false): TrendValue {
  if (previous === 0 && current === 0) return { pctChange: 0, direction: 'stable' };
  if (previous === 0) {
    // For sum metrics (cost/executions), "no activity → some activity" is a
    // real, meaningful +100%. For average metrics (successRate/latency), a
    // previous value of 0 typically means "no samples in the prior period",
    // not "the average was literally zero" — presenting that as a precise
    // "+100%" fabricates a delta from missing data. Suppress it instead.
    if (isAverage) return { pctChange: 0, direction: 'stable' };
    return { pctChange: 100, direction: 'up' };
  }
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
  const split = splitComparisonPeriods(chartData, effectiveDays, compareEnabled);
  if (!split) return null;
  const { previous: prev, current: curr } = split;

  return {
    cost: makeTrend(sumField(curr, 'cost'), sumField(prev, 'cost')),
    executions: makeTrend(sumField(curr, 'executions'), sumField(prev, 'executions')),
    successRate: makeTrend(avgField(curr, 'successRate'), avgField(prev, 'successRate'), true),
    latency: makeTrend(avgField(curr, 'p50'), avgField(prev, 'p50'), true),
  };
}
