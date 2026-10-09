// Outcomes by where a change came from (task, commit, pull request), so a
// step's record can say "commits skip Land, tasks do not". Pure: no React, no
// i18n, no IO. The rate is the same done rate as the adherence figure's.
import type { LifecycleSourceKind } from '@/lib/bindings/LifecycleSourceKind';

import type { EvidenceRow } from '../../blocks/evidenceRows';
import { doneRate } from './adherence';
import { outcomeCounts, type OutcomeCounts } from './evidenceModel';

export const SOURCE_ORDER: readonly LifecycleSourceKind[] = ['task', 'commit', 'pr'];

/** Points between two judged sources' rates before the screen calls the gap out. */
export const CONTRAST_PTS = 20;

export interface SourceSlice {
  kind: LifecycleSourceKind;
  counts: OutcomeCounts;
  /** Every change from this source, unknown included. */
  total: number;
  /** Changes the rate counts. */
  n: number;
  ratePct: number | null;
  judged: boolean;
}

/** One slice per source that has any change, in {@link SOURCE_ORDER}. */
export function sourceBreakdown(rows: readonly EvidenceRow[], minSamples: number): SourceSlice[] {
  return SOURCE_ORDER.flatMap((kind) => {
    const mine = rows.filter((r) => r.item.sourceKind === kind);
    if (mine.length === 0) return [];
    const counts = outcomeCounts(mine);
    const { n, ratePct } = doneRate(counts);
    return [{ kind, counts, total: mine.length, n, ratePct, judged: n >= minSamples }];
  });
}

/**
 * The widest gap between two judged sources, when it is at least
 * {@link CONTRAST_PTS} points: the source that keeps the step least and the
 * one that keeps it most. Null when fewer than two sources can be judged.
 */
export function sourceContrast(slices: readonly SourceSlice[]): { low: SourceSlice; high: SourceSlice } | null {
  const judged = slices.filter((s) => s.judged && s.ratePct != null);
  if (judged.length < 2) return null;
  const sorted = [...judged].sort((a, b) => a.ratePct! - b.ratePct!);
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  return high.ratePct! - low.ratePct! >= CONTRAST_PTS ? { low, high } : null;
}
