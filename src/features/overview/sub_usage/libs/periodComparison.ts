// -- Period-over-Period Comparison Utility ------------------------------------
// Merges a 2xN-day chart-point array so Recharts can render the previous
// period as ghost lines alongside the current one.

import { daysEndingAt, isIsoDay, latestDay, shiftDay } from '@/features/overview/libs/periodWindow';

export interface PeriodComparisonOptions<T> {
  /**
   * Row field holding a `YYYY-MM-DD` day key. Defaults to `rawDate`, the name
   * the Overview chart rows already carry it under. When every row has one, the
   * merge is done by CALENDAR OFFSET; without it the function falls back to the
   * old ordinal split (see the note on {@link mergePreviousPeriod}).
   */
  dateKey?: string;
  /** Last day of the current period. Defaults to the newest observed day. */
  endDate?: string;
  /**
   * Build a placeholder row for a current-period day with no data. Supplying it
   * makes the output span the whole calendar window instead of only the days
   * that had activity — the caller owns it because only the caller knows what
   * an empty row looks like on its own axis (display label, series keys).
   *
   * The placeholder carries NO data keys: a day with no runs has no latency and
   * no success rate, and writing 0 into those would be a measurement nobody
   * took. A caller whose keys are pure counts may put zeros in its own factory.
   */
  makeEmptyRow?: (isoDay: string) => T;
}

/**
 * Merge the previous period's values onto the current period's rows as
 * `prev_<key>` fields.
 *
 * **Aligned by calendar date, not by array position.** The previous value for
 * a given day is the value from exactly `periodDays` days earlier; when that
 * day has no row, no `prev_*` key is emitted for it. The old implementation cut
 * the series at `points.length - periodDays` and zipped the halves by ordinal
 * index, which is only correct when every calendar day produced a row — and the
 * rollup emits rows only for days with activity. Three quiet days shifted the
 * cut three days late, so the "previous period" ghost was drawn from the
 * current period's own earliest days, and it was drawn against the wrong dates.
 *
 * @param points     Time-series rows, sorted by date ascending.
 * @param periodDays Days in the current period (half the fetched window).
 * @param dataKeys   Numeric keys to carry over as `prev_<key>`.
 * @param options    See {@link PeriodComparisonOptions}.
 * @returns The current period's rows, each merged with the aligned previous
 *          day's values. Empty input returns `[]`.
 */
export function mergePreviousPeriod<T extends Record<string, string | number>>(
  points: T[],
  periodDays: number,
  dataKeys: string[],
  options: PeriodComparisonOptions<T> = {},
): (T & Record<string, string | number | undefined>)[] {
  if (points.length === 0) return [];

  const dateKey = options.dateKey ?? 'rawDate';
  const dated = points.filter((p) => isIsoDay(p[dateKey]));
  // A caller that carries no day key gets the historical behaviour rather than
  // an empty chart. It is wrong in the way described above, and it is the
  // caller's to fix by supplying dates — not something to silently drop data
  // over here.
  if (dated.length !== points.length) {
    return mergeByOrdinal(points, periodDays, dataKeys);
  }

  const end = options.endDate ?? latestDay(points.map((p) => p[dateKey]));
  if (end === null) return mergeByOrdinal(points, periodDays, dataKeys);

  const byDate = new Map<string, T>();
  for (const p of points) byDate.set(String(p[dateKey]), p);

  const out: (T & Record<string, string | number | undefined>)[] = [];
  for (const day of daysEndingAt(end, periodDays)) {
    const curr = byDate.get(day) ?? options.makeEmptyRow?.(day);
    if (!curr) continue; // quiet day, and the caller did not ask it to be filled
    const merged: Record<string, string | number | undefined> = { ...curr };
    const prev = byDate.get(shiftDay(day, -periodDays));
    if (prev) {
      for (const key of dataKeys) {
        const val = prev[key];
        if (typeof val === 'number') merged[`prev_${key}`] = val;
      }
    }
    out.push(merged as T & Record<string, string | number | undefined>);
  }
  return out;
}

/** The pre-2026-09 behaviour, kept for rows that carry no day key. */
function mergeByOrdinal<T extends Record<string, string | number>>(
  points: T[],
  periodDays: number,
  dataKeys: string[],
): (T & Record<string, string | number | undefined>)[] {
  const splitIdx = Math.max(0, points.length - periodDays);
  const prevPoints = points.slice(0, splitIdx);
  const currPoints = points.slice(splitIdx);

  return currPoints.map((curr, i) => {
    const merged: Record<string, string | number | undefined> = { ...curr };
    const prev = prevPoints[i];
    if (prev) {
      for (const key of dataKeys) {
        const val = prev[key];
        if (typeof val === 'number') merged[`prev_${key}`] = val;
      }
    }
    return merged as T & Record<string, string | number | undefined>;
  });
}
