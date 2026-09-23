// The Cadastre's own view of the board: the register's rows with their ranks,
// the parcel tone of every context, and the counts the band prints.
//
// Every rule is the page's shared one (`featureRules.ts`): whose move a row is
// on comes from `featureMove`, a parcel's tone from `squareTone`, the register
// order from `sortRows`. This file only renames them into the winner's
// vocabulary (a tone is a `ParcelCat`, the class the stylesheet paints) and
// adds the two things the Board never needed: the rank printed on the primary
// parcel, and the 100-row rehearsal.
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import { matchesQuery } from '@/lib/text/search';

import { sortRows, squareTone, type FeatureMove, type FeatureRow, type FeatureSort, type SquareTone } from '../featureRules';
import type { ContextCell, FeaturesModel } from '../featuresModel';

/** The winner's tone classes (`.c-proven`, `.f-gate`, ...), one per `SquareTone`. */
export type ParcelCat = 'proven' | 'gate' | 'trouble' | 'session' | 'staked' | 'platform' | 'tests' | 'open' | 'unknown';

export const PARCEL_CATS: readonly ParcelCat[] = ['proven', 'gate', 'trouble', 'session', 'staked', 'platform', 'tests', 'open', 'unknown'];

export function toneCat(tone: SquareTone): ParcelCat {
  switch (tone) {
    case 'settled': return 'proven';
    case 'gate': return 'gate';
    case 'trouble': return 'trouble';
    case 'running': return 'session';
    case 'claimed': return 'staked';
    case 'platform': return 'platform';
    case 'tests': return 'tests';
    case 'unclaimed': return 'open';
    default: return 'unknown';
  }
}

/** A deed's own standing: the tone a core parcel takes when this feature is
 *  its claim. One rule for the parcel and the deed, so they never disagree. */
export function standingOf(move: FeatureMove): ParcelCat {
  return toneCat(squareTone('core', move));
}

/** The register's group class for a move (`.grp.g-*`); `never` is calm. */
export function groupTone(move: FeatureMove): ParcelCat | 'none' {
  return move === 'never' ? 'none' : standingOf(move);
}

export type CadFilter = 'waiting' | 'trouble' | 'unclaimed';

export interface CadRow {
  row: FeatureRow;
  /** Unique in the register; a rehearsal copy carries `~<n>`. */
  key: string;
  /** Position in the whole sorted register, 1-based. */
  rank: number;
  /** The rehearsal copy number, or null for a real feature. */
  dup: number | null;
}

/** The DEV rehearsal: the real roster, then copies of it until there are 100
 *  rows. Copies claim the same parcels, so only the claim counts grow. */
export function rehearse(rows: FeatureRow[], size = 100): { row: FeatureRow; key: string; dup: number | null }[] {
  const out = rows.map((row) => ({ row, key: row.feature.id, dup: null as number | null }));
  if (rows.length === 0) return out;
  for (let k = 2; out.length < size; k += 1) {
    for (const row of rows) {
      if (out.length >= size) break;
      const feature: BoardFeature = { ...row.feature, id: `${row.feature.id}~${k}`, slug: `${row.feature.slug}~${k}` };
      out.push({ row: { ...row, feature }, key: feature.id, dup: k });
    }
  }
  return out;
}

/** Sort the roster with the page's rule and number it. */
export function rankRoster(roster: { row: FeatureRow; key: string; dup: number | null }[], sort: FeatureSort): CadRow[] {
  const byKey = new Map(roster.map((r) => [r.row.feature.id, r]));
  return sortRows(roster.map((r) => r.row), sort).map((row, i) => {
    const r = byKey.get(row.feature.id);
    return { row, key: row.feature.id, rank: i + 1, dup: r?.dup ?? null };
  });
}

export function matchesFilter(r: CadRow, filter: CadFilter | null): boolean {
  if (filter === 'waiting') return r.row.move === 'waiting';
  if (filter === 'trouble') return r.row.move === 'trouble';
  return true;
}

/** Name or any claimed context, as the winner's filter reads. */
export function matchesRow(r: CadRow, query: string, contextName: (id: string) => string, language: string): boolean {
  if (!query) return true;
  if (matchesQuery(r.row.feature.name, query, language)) return true;
  return r.row.feature.contextIds.some((id) => matchesQuery(contextName(id), query, language));
}

/** Context id -> the register rows that claim it (rehearsal copies included). */
export function claimsOf(rows: CadRow[]): Map<string, CadRow[]> {
  const out = new Map<string, CadRow[]>();
  for (const r of rows) {
    for (const id of r.row.feature.contextIds) {
      const list = out.get(id);
      if (list) list.push(r);
      else out.set(id, [r]);
    }
  }
  return out;
}

/** Context id -> its parcel tone, from the page's own `squareTone`. */
export function catsOf(model: FeaturesModel): Map<string, ParcelCat> {
  const out = new Map<string, ParcelCat>();
  for (const [id, cell] of model.cellById) out.set(id, cellCat(cell));
  return out;
}

export function cellCat(cell: ContextCell): ParcelCat {
  return toneCat(squareTone(cell.role, cell.claimMove));
}

/** The claimed share: every context that is neither platform, tests nor
 *  unclaimed ground, over all of them. Null for an empty map, never 0%. */
export function claimedShare(cats: Map<string, ParcelCat>): { claimed: number; total: number; ratio: number | null } {
  let claimed = 0;
  for (const c of cats.values()) if (c !== 'platform' && c !== 'tests' && c !== 'open' && c !== 'unknown') claimed += 1;
  const total = cats.size;
  return { claimed, total, ratio: total === 0 ? null : claimed / total };
}

export function countCats(cats: Map<string, ParcelCat>): Record<ParcelCat, number> {
  const n = Object.fromEntries(PARCEL_CATS.map((c) => [c, 0])) as Record<ParcelCat, number>;
  for (const c of cats.values()) n[c] += 1;
  return n;
}
