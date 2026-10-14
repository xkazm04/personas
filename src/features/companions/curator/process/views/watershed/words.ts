import { formatDuration, formatPercent } from '@/lib/utils/formatters';
import type { SpineModel } from '../../engine/spine';
import { stationName, type ProcessStrings } from '../../labels';
import type { MapWords } from './labels';

export type WatershedStrings = ProcessStrings['watershed'];
export type Tx = (template: string, vars: Record<string, string | number>) => string;

/** A duration in seconds as the app writes it; an unmeasured one is a dash. */
export const dur = (sec: number) => (Number.isFinite(sec) ? formatDuration(Math.round(sec), { unit: 's' }) : '–');

/** A share as a whole percent in the reader's locale; "–" when there is no denominator. */
export function share(k: number, n: number): string {
  return n ? formatPercent((100 * k) / n, { precision: 0 }) : '–';
}

/** A share, with "<1%" for a share that is real but rounds to nothing. */
export function pctText(k: number, n: number): string {
  if (!n) return '–';
  return k > 0 && (100 * k) / n < 0.5 ? `<${formatPercent(1, { precision: 0 })}` : share(k, n);
}

/** Shortest-first fitting: the first form that fits `room` px, else the last. */
export function fit(forms: string[], room: number, measure: (s: string) => number): string {
  return forms.find((f) => measure(f) <= room) ?? forms[forms.length - 1]!;
}

export function mapWords(p: ProcessStrings, tx: Tx, m: SpineModel): MapWords {
  const w = p.watershed;
  return {
    marshLong: (c) => tx(w.marsh_long, { count: c }),
    marshShort: (c) => tx(w.marsh_short, { count: c }),
    lakeLong: (c) => tx(w.lake_long, { count: c }),
    lakeShort: (c) => tx(w.lake_short, { count: c }),
    spring: w.spring,
    setOut: (n) => tx(w.set_out, { count: n }),
    place: (q) => stationName(p, m.stations[q]?.keys ?? []),
    ghost: w.ghost,
    waitForms: (q) => {
      const s = m.stations[q]!;
      const value = dur(s.medWait), p75 = dur(s.p75Wait), has = Number.isFinite(s.p75Wait);
      return [
        ...(has ? [tx(w.wait_long, { value, p75 }), tx(w.wait_mid, { value, p75 })] : []),
        tx(w.wait_short, { value }),
        value,
      ];
    },
    deltaHead: p.outcomes_title,
  };
}

/** Day and month of the first and last session start, in the reader's language. */
export function windowText(starts: readonly string[], language: string): { from: string; to: string } {
  let lo = Infinity, hi = -Infinity;
  for (const s of starts) { const v = Date.parse(s); if (v < lo) lo = v; if (v > hi) hi = v; }
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }); } catch { f = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }); }
  const d = (v: number) => (Number.isFinite(v) ? f.format(new Date(v)) : '–');
  return { from: d(lo), to: d(hi) };
}
