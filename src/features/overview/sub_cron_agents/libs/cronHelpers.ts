export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** Locale-aware relative time, past AND future ("in 5 min." / "3 hr. ago").
 *  Distinct from lib/utils/formatters.ts#formatRelativeTime, which is past-only;
 *  schedules need the future direction for next-fire labels. Uses the same
 *  `undefined`-locale convention as the shared AbsoluteTime component. */
const RELATIVE_FMT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });

export function formatRelative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return RELATIVE_FMT.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return RELATIVE_FMT.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return RELATIVE_FMT.format(Math.round(diff / 3_600_000), 'hour');
  return RELATIVE_FMT.format(Math.round(diff / 86_400_000), 'day');
}
