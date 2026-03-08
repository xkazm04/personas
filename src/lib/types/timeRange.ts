/**
 * Explicit time range types to disambiguate "calendar month" from "rolling N days".
 *
 * Budget enforcement uses calendar-month boundaries (1st of month to now).
 * Analytics dashboards use rolling-day windows (last N days from now).
 */

/** A calendar month boundary: 1st of given month to end of month (or now). */
export interface CalendarMonthRange {
  kind: 'calendar-month';
  /** ISO YYYY-MM, e.g. "2026-03" */
  month: string;
}

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

export type TimeRange = CalendarMonthRange | RollingDaysRange | CustomRange;

/** Resolve a TimeRange to concrete start/end ISO date strings. */
export function resolveTimeRange(range: TimeRange): { startDate: string; endDate: string; label: string } {
  const now = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);

  switch (range.kind) {
    case 'calendar-month': {
      const [year, month] = range.month.split('-').map(Number);
      const start = new Date(year!, month! - 1, 1);
      const isCurrentMonth =
        now.getFullYear() === year && now.getMonth() === month! - 1;
      const end = isCurrentMonth
        ? now
        : new Date(year!, month!, 0); // last day of the month
      const monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return {
        startDate: toISO(start),
        endDate: toISO(end),
        label: `Calendar month: ${monthLabel}`,
      };
    }
    case 'rolling-days': {
      const end = now;
      const start = new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000);
      return {
        startDate: toISO(start),
        endDate: toISO(end),
        label: `Last ${range.days} day${range.days === 1 ? '' : 's'}`,
      };
    }
    case 'custom': {
      const fmtShort = (iso: string) => {
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      };
      return {
        startDate: range.startDate,
        endDate: range.endDate,
        label: `${fmtShort(range.startDate)} – ${fmtShort(range.endDate)}`,
      };
    }
  }
}

/** Get the current calendar month as a CalendarMonthRange. */
export function currentCalendarMonth(): CalendarMonthRange {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { kind: 'calendar-month', month };
}
