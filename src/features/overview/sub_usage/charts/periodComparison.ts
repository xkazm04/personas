// -- Period-over-Period Comparison Utility ----------------------------
// Splits a 2×N day chart-point array into current (latter half) and
// previous (first half), then merges them by ordinal index so Recharts
// can render the previous period as ghost lines alongside the current.

/**
 * Given an array of chart points covering 2× the desired period (fetched
 * with `days * 2`), split into previous and current halves and merge by
 * ordinal position.  Previous-period values are prefixed with `prev_`.
 *
 * @param points     Full array of time-series points (sorted by date asc).
 * @param periodDays The number of days in the current period (half the total).
 * @param dataKeys   The numeric keys to carry from previous period (e.g. ["cost", "executions"]).
 */
export function mergePreviousPeriod<T extends Record<string, string | number>>(
  points: T[],
  periodDays: number,
  dataKeys: string[],
): (T & Record<string, string | number | undefined>)[] {
  if (points.length === 0) return [];

  // Split: first `periodDays` points are previous, rest are current
  const splitIdx = Math.max(0, points.length - periodDays);
  const prevPoints = points.slice(0, splitIdx);
  const currPoints = points.slice(splitIdx);

  return currPoints.map((curr, i) => {
    const merged: Record<string, string | number | undefined> = { ...curr };
    const prev = prevPoints[i];
    if (prev) {
      for (const key of dataKeys) {
        const val = prev[key];
        if (typeof val === 'number') {
          merged[`prev_${key}`] = val;
        }
      }
    }
    return merged as T & Record<string, string | number | undefined>;
  });
}
