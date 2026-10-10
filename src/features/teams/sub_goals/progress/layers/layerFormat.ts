/**
 * Dates and percents for every layered view, in the language the operator
 * chose in the app (`useTranslation().language`), never the host OS's
 * (census `host-locale-date-render`, `locale-blind-percent`).
 */
/**
 * A milestone's target as a short date in the reader's language. The year is
 * shown only when it is not this year. `null` for a missing or broken date, so
 * a caller renders nothing rather than the literal "Invalid Date".
 */
export function formatTarget(iso: string | null, language: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(language, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? null : { year: 'numeric' }),
  });
}

/** 0-100 as a percent in the reader's language (`42 %` in French, `42%` in English). */
export function formatPct(pct: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(pct / 100);
}
