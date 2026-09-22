// One KPI, one plot of land — and the two lenses the map can read it under.
//
// The STATE lens paints the verdict, and paints nothing at all when there is
// no reading: a dark plot is the absence of evidence, which is why the map can
// never flatter itself. The FRESHNESS lens paints the AGE of the reading
// instead, which answers a different question with the same geometry: not
// "how are we doing" but "when did anyone last look".
//
// Two marks ride on top of either lens, because they are facts about the
// measurement rather than about the number:
//   * a DASHED edge - read, but older than the cadence it promised itself;
//   * a DOT - never read at all, on a KPI that promised a daily or weekly
//     reading. A broken promise is not the same absence as a KPI nobody ever
//     claimed to watch.
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { kpiTrack, type KpiTrack } from '../../kpiMath';
import { ageDays, freshDays, isStale } from '../../estate/kpiEstate';

export type MapLens = 'state' | 'freshness';

export const TRACK_COLOR: Record<Exclude<KpiTrack, 'unmeasured'>, string> = {
  met: 'var(--status-success)',
  'on-track': 'var(--primary)',
  'off-track': 'var(--status-error)',
  unpaced: 'var(--status-warning)',
};

/** Cadences that amount to a promise of a rhythm. A `manual` KPI never made
 *  one, so its silence is not a broken promise. */
const PROMISED_CADENCES = new Set(['daily', 'weekly', 'biweekly']);

export interface PlotStyle {
  /** null = dark: nothing has ever been read here. */
  fill: string | null;
  /** True when the reading has outlived its cadence. */
  stale: boolean;
  /** True when a rhythm was promised and never delivered. */
  brokenPromise: boolean;
  track: KpiTrack;
}

/** Fraction of the way from fresh to abandoned, 0..1, for the freshness lens. */
export function freshnessFraction(kpi: DevKpi, now: number): number | null {
  const age = ageDays(kpi, now);
  if (age == null) return null;
  return Math.max(0, Math.min(1, age / (freshDays(kpi.cadence) * 3)));
}

function freshnessColor(f: number): string {
  if (f < 0.34) return 'var(--status-success)';
  if (f < 0.67) return 'var(--status-warning)';
  return 'var(--status-error)';
}

export function plotStyle(kpi: DevKpi, now: number, lens: MapLens): PlotStyle {
  const track = kpiTrack(kpi);
  const dark = track === 'unmeasured';
  const fresh = freshnessFraction(kpi, now);
  return {
    fill: dark ? null : lens === 'state' ? TRACK_COLOR[track] : fresh == null ? null : freshnessColor(fresh),
    stale: isStale(kpi, now),
    brokenPromise: dark && PROMISED_CADENCES.has(kpi.cadence ?? 'manual'),
    track,
  };
}

/** How many plots in this scope are a broken promise — the number the legend
 *  prints so the dot is a quantity and not a curiosity. */
export function brokenPromises(kpis: DevKpi[]): number {
  return kpis.reduce(
    (n, k) => n + (kpiTrack(k) === 'unmeasured' && PROMISED_CADENCES.has(k.cadence ?? 'manual') ? 1 : 0),
    0,
  );
}
