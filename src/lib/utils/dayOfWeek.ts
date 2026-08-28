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
 * conventions.
 *
 * **Everything here is machine vocabulary, not display text.** A `DAYS` array
 * of English day names for "week-grid UIs" used to sit alongside it, carrying
 * `short: 'Mon'` / `label: 'Monday'` in a 14-locale app. It was removed rather
 * than translated: measured across the whole tree it had exactly zero
 * consumers, so it was never a live i18n gap -- it was a loaded gun for
 * whoever rendered it next, and it also pinned this file's doc comment to a
 * promise ("a single place to add locale-aware names") that i18n never took up
 * because the app resolves labels through the catalog, not through a lib
 * constant. A week grid needs `t`; build its labels from the catalog and keep
 * the cron digit as the key.
 */

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
 * The FIRST day mentioned wins; a tie at one position goes to the longer name,
 * so "tuesday" beats "tue" where both could match the same text.
 *
 * The previous implementation sorted the names longest-first and returned the
 * first that matched *anywhere*, which is not what its own doc claimed and has
 * no position logic in it at all. On "run Tuesday, skip Wednesday" it returned
 * Wednesday, purely because "wednesday" is the longer word — the stated intent
 * (disambiguate a prefix from its full name at one site) had generalised into
 * "the longest day name mentioned anywhere wins".
 */
export function findDayOfWeekInText(input: string): string | null {
  const lower = input.toLowerCase();
  if (/\bweekday/.test(lower)) return '1-5';
  if (/\bweekend/.test(lower)) return '0,6';

  let best: { index: number; length: number; num: number } | null = null;
  for (const [name, num] of Object.entries(DAY_NAME_TO_NUM)) {
    const match = new RegExp(`\\b${name}s?\\b`).exec(lower);
    if (!match) continue;
    if (
      !best ||
      match.index < best.index ||
      (match.index === best.index && name.length > best.length)
    ) {
      best = { index: match.index, length: name.length, num };
    }
  }
  return best ? String(best.num) : null;
}
