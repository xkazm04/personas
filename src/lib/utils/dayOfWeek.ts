/**
 * Canonical day-of-week vocabulary for cron/scheduling code.
 *
 * Cron DOW digits: 0 = Sunday, 1 = Monday, ..., 6 = Saturday (POSIX).
 * Three frontend surfaces previously reimplemented this data:
 *
 *   - `agents/sub_use_cases/scheduleHelpers.ts` (DAYS array for UI toggles)
 *   - `lib/types/schedule.ts` (DOW_MAP for ISO weekday → cron digit)
 *   - `triggers/sub_triggers/nlTriggerParser.ts` (regex day-name matcher)
 *
 * Centralising stops the three from drifting on Monday=1 vs. Sunday=0
 * conventions, and gives a single place to add Locale-aware names if
 * the i18n migration later reaches scheduling labels.
 */

export interface DayInfo {
  /** Cron DOW digit as string ("0"-"6"). Sunday is "0". */
  readonly key: string;
  /** Three-letter English abbreviation ("Mon", "Tue", …). */
  readonly short: string;
  /** Full English name ("Monday", "Tuesday", …). */
  readonly label: string;
}

/**
 * Days ordered Monday-first for week-grid UIs. Sunday comes last because
 * most users in the supported locales read calendars Mon→Sun. The `key`
 * field is still the POSIX cron digit, so Sunday's key is "0" even though
 * it appears at the end of this array.
 */
export const DAYS: readonly DayInfo[] = [
  { key: '1', short: 'Mon', label: 'Monday' },
  { key: '2', short: 'Tue', label: 'Tuesday' },
  { key: '3', short: 'Wed', label: 'Wednesday' },
  { key: '4', short: 'Thu', label: 'Thursday' },
  { key: '5', short: 'Fri', label: 'Friday' },
  { key: '6', short: 'Sat', label: 'Saturday' },
  { key: '0', short: 'Sun', label: 'Sunday' },
] as const;

/**
 * Lowercase short and long day names → cron DOW digit. Combined so both
 * the ISO-shortname caller (Schedule.frequencyToSchedule) and the NL
 * regex caller (nlTriggerParser) share one lookup.
 */
export const DAY_NAME_TO_NUM: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Search free text for a day-of-week mention. Returns:
 *   - "1-5" / "0,6" for "weekday" / "weekend"
 *   - "0"–"6" for a specific day
 *   - null if no match
 *
 * Names are matched longest-first so "tuesday" wins over "tue" when both
 * appear at the same position.
 */
export function findDayOfWeekInText(input: string): string | null {
  const lower = input.toLowerCase();
  if (/\bweekday/.test(lower)) return '1-5';
  if (/\bweekend/.test(lower)) return '0,6';

  const namesByLength = Object.keys(DAY_NAME_TO_NUM).sort((a, b) => b.length - a.length);
  for (const name of namesByLength) {
    if (new RegExp(`\\b${name}s?\\b`).test(lower)) {
      return String(DAY_NAME_TO_NUM[name]);
    }
  }
  return null;
}
