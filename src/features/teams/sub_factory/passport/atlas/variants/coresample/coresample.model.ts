// Core Sample — the derivations a cut needs.
//
// THE MEASUREMENT THAT FORCED THEM. A dimension in this portfolio is not a
// column of 102 verdicts; it is a column of 102 answers of which only a
// handful were ever taken. 14 of the 102 projects on this machine have a
// cross-project scan at all (dev_scans, 2026-10-06), so for most dimensions
// the honest statement is "cut 9 of 102 deep", and the matrix had nowhere to
// put that number except prose in the column head. A core states it at its own
// foot, and draws the uncut remainder as rock rather than as ninety-three
// empty dots.
import type { AppPassport } from '../../../passportModel';
import { inkOf, type AtlasInk, type AtlasRow } from '../../atlasModel';
import { ABSENT } from '../stampsheet/stampsheet.model';

export interface CoreStats {
  total: number;
  /** Laminae carrying a verdict: the depth this dimension has actually been cut to. */
  known: number;
  counts: Record<AtlasInk, number>;
}

const ZERO = (): Record<AtlasInk, number> =>
  ({ bad: 0, warn: 0, good: 0, setup: 0, info: 0, unknown: 0 });

export function coreStats(projects: AppPassport[], row: AtlasRow): CoreStats {
  const counts = ZERO();
  for (const p of projects) counts[inkOf(p, row)] += 1;
  const known = Object.entries(counts)
    .filter(([k]) => !ABSENT.has(k))
    .reduce((n, [, v]) => n + v, 0);
  return { total: projects.length, known, counts };
}

/** Cores ordered by how far they have been cut, deepest first: the portfolio's
 *  frontier becomes a silhouette instead of a list in the lens's own order. */
export function byDepth(projects: AppPassport[], rows: AtlasRow[]): Array<{ row: AtlasRow; di: number; stats: CoreStats }> {
  return rows
    .map((row, di) => ({ row, di, stats: coreStats(projects, row) }))
    .sort((a, b) => b.stats.known - a.stats.known || a.di - b.di);
}

/** Depth marks down the axis beside the cores, so the operator can say which
 *  of the 102 he is on without counting laminae. Always carries the last
 *  index, which is the denominator. */
export function depthTicks(n: number, every = 10): number[] {
  if (n <= 1) return n === 1 ? [0] : [];
  const ticks: number[] = [];
  for (let i = 0; i < n - 1; i += every) ticks.push(i);
  ticks.push(n - 1);
  return ticks;
}
