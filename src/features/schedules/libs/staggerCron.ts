/**
 * Shift a cron expression's minutes out of a collision window.
 *
 * `FrequencyEditor` already counts, backend-side, how many times a candidate
 * cadence lands within `CONFLICT_WINDOW_MS` (5 minutes) of another schedule in
 * the next 7 days — and then only warns. The count the product already pays for
 * had no action attached to it, so the operator's options were "save anyway" or
 * "hand-edit the expression and watch the number".
 *
 * WHAT THIS DOES NOT CLAIM. It does not solve for a zero-conflict cadence.
 * Moving off one collision can land on another, so the caller applies the shift
 * and lets the existing preview RE-COUNT, which is also why the control is
 * repeatable. A helper that promised zero would be promising something only a
 * search over every existing trigger's fire times could deliver, and that
 * search is 1+N IPC round-trips per attempt.
 *
 * WHAT IT REFUSES, and why refusing matters more than shifting:
 *   - a wildcard minute, a step minute (asterisk-slash-N), a range such as
 *     `1-30`, or any other non-literal minute field. Shifting a wildcard is
 *     meaningless and rewriting a step would silently change the cadence the
 *     operator chose.
 *   - `H` and `H/15` (this repo's hash-seeded spread tokens). The engine picks
 *     those minutes itself; a literal here would pin what was deliberately
 *     spread.
 * In every refused case it returns `null` and the caller renders no CTA, rather
 * than producing an expression the operator did not ask for.
 *
 * SEMANTIC NOTE, stated rather than hidden: a minute that wraps past 59 comes
 * back at the low end of the SAME hour (`58` + 5 → `3`), because cron's minute
 * field cannot carry into the hour field on its own. The fire moves within the
 * hours the expression already selects, which is the intent — it is a stagger,
 * not a reschedule.
 */

/** The collision window `useConflictPreview` and `calendarHelpers` both use. */
export const STAGGER_MINUTES = 5;

const LITERAL_MINUTES = /^\d{1,2}(,\d{1,2})*$/;

/** Index of the minute field: 6-field expressions are seconds-first. */
function minuteFieldIndex(fields: string[]): number | null {
  if (fields.length === 5) return 0;
  if (fields.length === 6) return 1;
  return null;
}

/**
 * Return `cron` with every literal minute moved forward by `delta`, or `null`
 * when the expression is not one this may safely rewrite.
 */
export function staggerCron(cron: string, delta = STAGGER_MINUTES): string | null {
  const trimmed = cron.trim();
  if (!trimmed) return null;
  const fields = trimmed.split(/\s+/);
  const idx = minuteFieldIndex(fields);
  if (idx === null) return null;

  const minuteField = fields[idx];
  if (!minuteField || !LITERAL_MINUTES.test(minuteField)) return null;

  const shifted = minuteField
    .split(',')
    .map((m) => Number(m))
    .filter((m) => Number.isInteger(m) && m >= 0 && m <= 59)
    .map((m) => (((m + delta) % 60) + 60) % 60);
  if (shifted.length === 0) return null;

  // Dedupe and sort: two minutes that collide after the shift must not become a
  // duplicated entry, and an ordered field is what the operator expects to read
  // back.
  const unique = [...new Set(shifted)].sort((a, b) => a - b);
  const next = [...fields];
  next[idx] = unique.join(',');
  const result = next.join(' ');
  // A shift that changed nothing (delta a multiple of 60) is not an offer.
  return result === trimmed ? null : result;
}

/** Whether the warning should offer the shift at all. */
export function canStagger(cron: string): boolean {
  return staggerCron(cron) !== null;
}
