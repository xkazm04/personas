// Stamp Sheet — the derivations the sheet needs and the matrix never did.
//
// THE MEASUREMENT THAT FORCED THEM. 102 projects on this machine (2026-10-06),
// and 74 of them are named `Gig · <discipline> · <a sentence>` at up to 86
// characters. The baseline matrix gives a name 248px, `white-space: nowrap`
// and an ellipsis, so for three quarters of the portfolio the identity column
// reads `Gig · Web development · Bu…` and identifies nothing. A stamp has two
// lines and no ellipsis, which is only useful if the name is cut where its own
// punctuation already cuts it.
import type { AppPassport } from '../../../passportModel';
import { inkOf, type AtlasRow } from '../../atlasModel';

/** The states that mean "nobody has measured this yet", as opposed to a verdict. */
export const ABSENT = new Set(['setup', 'unknown']);

/** A name split where it already punctuates itself: the qualifying lead, then
 *  the thing itself. `Gig · Frontend · Add print styles` → lead `Gig ·
 *  Frontend`, title `Add print styles`. A name with no ` · ` keeps all of
 *  itself as the title and gets no lead. */
export function splitLead(name: string): { lead: string | null; title: string } {
  const parts = name.split(' · ').map((s) => s.trim()).filter(Boolean);
  const title = parts[parts.length - 1];
  if (parts.length < 2 || title === undefined) return { lead: null, title: name };
  return { lead: parts.slice(0, -1).join(' · '), title };
}

/** The denominator the stamp states on itself: how many of the lens's
 *  dimensions carry a verdict at all. `3/14` is the honest headline for a
 *  project nobody has scanned - the matrix drew fourteen identical empty dots
 *  for the same fact. */
export function measured(p: AppPassport, rows: AtlasRow[]): { known: number; total: number } {
  return { known: rows.filter((r) => !ABSENT.has(inkOf(p, r))).length, total: rows.length };
}

/** The seal: the single worst verdict on the stamp, or `unknown` for a
 *  checkout the probe could not read. Same rule the matrix row header used. */
export function seal(p: AppPassport, rows: AtlasRow[]) {
  if (p.repoUnreadable) return 'unknown' as const;
  const inks = rows.map((r) => inkOf(p, r));
  return inks.includes('bad') ? 'bad' as const
    : inks.includes('warn') ? 'warn' as const
    : inks.some((i) => !ABSENT.has(i)) ? 'good' as const
    : 'setup' as const;
}

/** How wide the mosaic is. Near-square, capped so a 30-dimension mosaic stays
 *  a block and never becomes a strip. */
export const mosaicCols = (n: number) => Math.max(1, Math.min(6, Math.ceil(Math.sqrt(Math.max(1, n)))));
