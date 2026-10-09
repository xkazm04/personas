// The docs change log by day: the changes that recorded a docs outcome,
// newest first, cut into the calendar days they happened on IN ONE ZONE (the
// reader's, named explicitly, so a day key never depends on how the host
// spells midnight), each day labelled Today / Yesterday / its date. Pure.
import type { EvidenceRow } from '../../blocks/evidenceRows';

export interface LogDay {
  /** YYYY-MM-DD in the zone, or "" when the change's time cannot be read. */
  key: string;
  rows: EvidenceRow[];
}

/** YYYY-MM-DD of an instant in `timeZone` ("" for an unreadable time). */
export function dayKey(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA formats a date as YYYY-MM-DD; the locale here is a key format, never shown.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Consecutive rows on the same day form one group; the order of `rows` is kept. */
export function groupByDay(rows: EvidenceRow[], timeZone: string): LogDay[] {
  const days: LogDay[] = [];
  for (const r of rows) {
    const key = dayKey(r.item.occurredAt, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else days.push({ key, rows: [r] });
  }
  return days;
}

/** Whole days from `key` to `todayKey` (both YYYY-MM-DD): 0 today, 1 yesterday; null when either is unreadable. */
export function daysAgo(key: string, todayKey: string): number | null {
  const at = Date.parse(`${key}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(at) || Number.isNaN(today)) return null;
  return Math.round((today - at) / 86_400_000);
}
