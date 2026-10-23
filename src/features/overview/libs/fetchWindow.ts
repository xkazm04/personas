/**
 * The explicit [start, end) window sent to the backend for a custom date range.
 *
 * Presets (7d / 30d / 90d) send `days` only and the backend counts back from
 * now. A custom range names calendar days, so it must travel as timestamps:
 * reducing it to a day count fetched "the last N days ending today" under a
 * label naming Jan 1-10.
 */
export interface FetchWindow {
  /** RFC 3339, inclusive lower bound. */
  start: string;
  /** RFC 3339, exclusive upper bound. */
  end: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of a YYYY-MM-DD date. */
function localMidnight(iso: string, plusDays = 0): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d! + plusDays);
}

/** Inclusive day count of a custom [start, end] range (Jan 1-10 is 10 days). */
export function customRangeDays(range: readonly [string, string]): number {
  const ms = localMidnight(range[1]).getTime() - localMidnight(range[0]).getTime();
  return Math.max(1, Math.round(ms / DAY_MS) + 1);
}

/**
 * Window to fetch for a custom range, or null for a preset (days-only call).
 * The chosen end day is inclusive, so the exclusive bound is the next local
 * midnight. With Compare on the window is stretched back by one more period
 * so the prior period arrives in the same call (the preset path does this by
 * doubling `days`).
 */
export function buildFetchWindow(
  customRange: readonly [string, string] | null,
  compareEnabled: boolean,
): FetchWindow | null {
  if (!customRange) return null;
  const days = customRangeDays(customRange);
  const start = localMidnight(customRange[0], compareEnabled ? -days : 0);
  const end = localMidnight(customRange[1], 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Stable identity of a window, for cache/reuse comparisons. '' = days-only. */
export function fetchWindowKey(window: FetchWindow | null | undefined): string {
  return window ? `${window.start}|${window.end}` : '';
}
