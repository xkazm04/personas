/**
 * Day-separator helpers for the transcript.
 */

const ONE_DAY_MS = 86_400_000;

/** Same calendar day in local time. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Label for a transcript day separator: "Today" / "Yesterday" for the recent
 * days (callers pass the localized strings), otherwise a locale-formatted
 * weekday + date. Matches how RelativeTime defers absolute dates to the
 * browser locale.
 */
export function daySeparatorLabel(
  iso: string,
  todayLabel: string,
  yesterdayLabel: string,
): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameLocalDay(d, now)) return todayLabel;
  if (sameLocalDay(d, new Date(now.getTime() - ONE_DAY_MS))) return yesterdayLabel;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** True when `iso` opens a new calendar day relative to `prevIso`. */
export function startsNewDay(iso: string | undefined, prevIso: string | undefined): boolean {
  if (!iso) return false;
  if (!prevIso) return true;
  return !sameLocalDay(new Date(prevIso), new Date(iso));
}
