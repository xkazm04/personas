/**
 * Daily cost points bucketed into the trailing 5 calendar months.
 *
 * Lifted verbatim from `LimitsSettings` so the Limits tab's usage table and the
 * always-mounted `SpendAlertWatcher` cannot disagree about which month is
 * "this month" or what it cost.
 */

/** The monthly spend ceiling setting (USD; unset or 0 = no ceiling). */
export const CEILING_KEY = 'monthly_cost_ceiling_usd';

/** One trailing calendar month of total spend. */
export type MonthSpend = { key: string; label: string; spend: number };

/** The two fields bucketing reads from a `MetricsChartPoint`. */
export type SpendPoint = { date: string; cost: number };

/** Days of daily points to fetch so 5 whole calendar months are covered. */
export const MONTHLY_SPEND_DAYS = 186;

/**
 * Index 0 is the current month (descending). "Current" is anchored on the
 * server's own bucketed date domain (the max chart_points date) rather than
 * the client's local clock: a client behind or ahead of the server around a
 * month boundary would otherwise mislabel the head row for a few hours.
 */
export function bucketMonthlySpend(chartPoints: readonly SpendPoint[]): MonthSpend[] {
  const byMonth = new Map<string, number>();
  for (const pt of chartPoints) {
    const key = pt.date.slice(0, 7); // YYYY-MM (server-bucketed calendar date)
    // `cost` is a non-optional f64 on MetricsChartPoint (core/models/observability.rs),
    // so there is no unknown to default; the `?? 0` the tab carried was dead.
    byMonth.set(key, (byMonth.get(key) ?? 0) + pt.cost);
  }
  const maxKey = chartPoints.reduce<string | null>((acc, pt) => {
    const key = pt.date.slice(0, 7);
    return !acc || key > acc ? key : acc;
  }, null);
  const anchor = maxKey ? new Date(`${maxKey}-01T00:00:00Z`) : new Date();
  const months: MonthSpend[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      spend: byMonth.get(key) ?? 0,
    });
  }
  return months;
}

/** The ceiling setting as a number; unset, invalid or non-positive reads as 0 (no ceiling). */
export function parseCeiling(raw: string | null | undefined): number {
  const n = Number(raw ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}
