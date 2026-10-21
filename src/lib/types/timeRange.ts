/**
 * Explicit time range types for analytics dashboards.
 *
 * Analytics dashboards use rolling-day windows (last N days from now) or an
 * operator-chosen custom range. Budget enforcement's calendar-month window is
 * resolved on the backend and never flows through this type.
 */

/** A rolling window of N days back from now. */
export interface RollingDaysRange {
  kind: 'rolling-days';
  days: number;
}

/** An explicit custom date range. */
export interface CustomRange {
  kind: 'custom';
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;   // ISO YYYY-MM-DD
}

export type TimeRange = RollingDaysRange | CustomRange;

/** Resolve a TimeRange to concrete start/end ISO date strings. */
export function resolveTimeRange(range: TimeRange): { startDate: string; endDate: string } {
  if (range.kind === 'rolling-days') {
    const end = new Date();
    const start = new Date(end.getTime() - range.days * 24 * 60 * 60 * 1000);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }
  return { startDate: range.startDate, endDate: range.endDate };
}

/** Translated templates a caller hands to {@link formatTimeRangeLabel}. */
export interface TimeRangeLabelTemplates {
  /** "Last day" */
  oneDay: string;
  /** "Last {count} days" */
  manyDays: (days: number) => string;
}

/**
 * Human label for a range. Copy comes from the caller (this module owns no
 * English); custom ranges render both ends through the active locale.
 */
export function formatTimeRangeLabel(
  range: TimeRange,
  templates: TimeRangeLabelTemplates,
  locale: string,
): string {
  if (range.kind === 'rolling-days') {
    return range.days === 1 ? templates.oneDay : templates.manyDays(range.days);
  }
  const fmtShort = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${fmtShort(range.startDate)} - ${fmtShort(range.endDate)}`;
}
