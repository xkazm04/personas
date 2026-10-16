// A lens field's value for reading on the feature page (bp lib/model/lens.ts fmtValue, present.ts hotHealth), in the
// active language: numbers through Intl, percents through the shared formatter, money with its currency. Booleans
// and enums are words the caller supplies. Pure; no React.
import { formatPercent } from '@/lib/utils/formatters';
import type { FeatureLens } from '../../standard/load';
import type { LensField, Scalar } from '../../standard/types';

const round = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10);

/** A number in the active language, bp's rounding (whole at 100 and over, one decimal under). */
export const nfmt = (language: string, v: number): string => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(round(v));

export interface YesNo { yes: string; no: string }

/** A field's value by type and unit; absent = the dash. */
export function fmtValue(language: string, f: LensField, v: Scalar | undefined | null, yn: YesNo): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? yn.yes : yn.no;
  if (typeof v === 'string') return v;
  if (f.type === 'percent') return formatPercent(round(v), { language, precision: Number.isInteger(round(v)) ? 0 : 1 });
  if (f.type === 'money') {
    let n: string;
    try { n = new Intl.NumberFormat(language, { style: 'currency', currency: f.currency, maximumFractionDigits: 0 }).format(v); }
    catch { n = nfmt(language, Math.round(v)) + ' ' + f.currency; }
    return n + (f.unit ? ' ' + f.unit : '');
  }
  return nfmt(language, v) + (f.unit ? ' ' + f.unit : '');
}

/** The mark a lens's rule puts on one of its fields: the lens's health when it is bad or watch and the rule names that field. */
export function hotHealth(fl: FeatureLens | undefined, key: string): 'bad' | 'watch' | '' {
  return fl && (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(key) ? fl.h : '';
}

/** Revision letters: A..Z, then AA, AB... (spreadsheet columns), so a long history never runs past the alphabet. */
export function revLabel(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A day (YYYY-MM-DD, or an ISO instant's day) in the active language; the raw text when it does not parse. */
export function dayFmt(language: string, d: string): string {
  const t = Date.parse(d.slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(t) ? d : new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(t);
}

/** A field read from the feature itself (stage, priority...) is shown in the page head, not again in a lens tab. */
export const ownField = (x: LensField): boolean => !(x.source && 'feature' in x.source);
