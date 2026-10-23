/**
 * Calendar arithmetic for period-over-period comparison.
 *
 * Every comparison surface in Overview used to split a `2 × days` series by
 * ARRAY POSITION — `points.length - periodDays`. That is only correct when the
 * series has one row per calendar day, and the pipeline emits rows only for
 * days that had activity. A window with three quiet days therefore cut the
 * series three days late, and the "previous period" silently became the last
 * few busy days of the current one: compare mode labelled a recent cluster as
 * last week.
 *
 * The fix is to do the arithmetic in days rather than in indices. These
 * helpers work on `YYYY-MM-DD` strings in UTC, which is the shape the daily
 * rollups already carry.
 */

/**
 * The zone every day key in this module is expressed in.
 *
 * The daily rollups the Overview charts read are bucketed server-side in UTC,
 * so the keys arrive in UTC and the arithmetic here stays in UTC. It is named
 * rather than implied: a day boundary that nobody chose is one the host machine
 * chooses, differently on every developer's laptop.
 */
const DAY_KEY_ZONE = 'UTC';

/** Matches a bare `YYYY-MM-DD` day key. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `true` when `value` is a day key this module can do arithmetic on. */
export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Formats an instant back to a day key in an explicitly named zone.
 *
 * `en-CA` is the locale whose short date IS `YYYY-MM-DD`, and naming the zone
 * is the point: a day key derived by slicing an ISO string silently picks UTC,
 * and one derived by mutating a Date silently picks the host machine's zone,
 * which is how the same expression is right in CI and wrong on a laptop
 * (`docs/concepts/golden-paths/schedule-calendar.md`).
 */
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_KEY_ZONE });

/**
 * `day` shifted by `delta` calendar days, as another `YYYY-MM-DD`.
 *
 * Pure day arithmetic: the input is already a day key, so this never has to
 * decide which day an instant falls on — it only moves the label. Both ends
 * stay in {@link DAY_KEY_ZONE}, so the shift is exact across DST.
 */
export function shiftDay(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000;
  return DAY_KEY.format(new Date(ms));
}

/**
 * The `count` calendar days ending at `end`, inclusive, oldest first.
 * A half-open `[start, end)` would drop the day the user is looking at, so the
 * window is closed at both ends and `count` is the number of days it contains.
 */
export function daysEndingAt(end: string, count: number): string[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => shiftDay(end, i - (count - 1)));
}

/** The newest day key in `days`, or `null` when none is usable. */
export function latestDay(days: readonly unknown[]): string | null {
  let latest: string | null = null;
  for (const d of days) {
    if (!isIsoDay(d)) continue;
    if (latest === null || d > latest) latest = d;
  }
  return latest;
}
