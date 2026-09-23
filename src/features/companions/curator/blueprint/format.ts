/**
 * The ledger's own number voice.
 *
 * Both helpers route through `lib/utils/formatters`, which is the canonical
 * home of display formatting and what `<Numeric>` itself calls. The primitive
 * is not used per figure here: a spread ledger paints thousands of numbers in
 * one frame, and one `useTranslation()` per glyph is not a thing to ship.
 * The formatters read the active language themselves, so the separators are
 * still the reader's.
 */
import { formatCount, formatNumeric, formatPercent } from '@/lib/utils/formatters';

/** A grouped integer. Never an em dash where a real count belongs. */
export function fmt(n: number | null | undefined): string {
  return formatCount(n, { precision: 0 });
}

/**
 * A declared dollar ceiling. Assembled by the shared unit formatter, not by a
 * `$` glued to a number: the symbol, its side and the separators are all the
 * reader's locale's, not this file's.
 */
export function usd(value: number): string {
  return formatNumeric(value, 'usd');
}

/**
 * A share of a whole, to one decimal. `null` when the whole is zero - which is
 * a different statement from `0.0%` and is rendered as such by the caller.
 */
export function share(part: number, whole: number, precision = 1): string | null {
  if (!whole) return null;
  return formatPercent((100 * part) / whole, { precision });
}

/** A percentage width for a bar, clamped so a hairline never vanishes. */
export function widthPct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${String(Math.max(0, Math.min(100, (100 * part) / whole)))}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A UTC day-and-minute stamp, for a scan whose clock is not this machine's. */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${hh}:${mm}`;
}

/** A UTC day, for a settled line that only needs the day. */
export function utcDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
}

/** `n` copies of whatever the caller draws, as an index array. */
export function times(n: number): number[] {
  return Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => i);
}
