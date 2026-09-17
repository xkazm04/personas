// Pure helpers behind the Strategic map (WP1, kpi-strategic-map spark). No
// React: the band census and the highlight predicate are the two pieces of
// logic worth testing, so they live here rather than inside a component.
import type { KpiBand, KpiProjectRollup } from '../kpiOverviewModel';
import { BAND_ORDER, UNGROUPED_KEY } from '../kpiOverviewModel';

/** A tiny shape glyph per band — a second, non-color channel for the state,
 *  so the map survives a color-blind reader and a grayscale screenshot. */
export const BAND_GLYPH: Record<KpiBand, string> = {
  met: '●',
  healthy: '●',
  mixed: '▲',
  strained: '✕',
  unmeasured: '⋯',
};

export interface BandCensus {
  /** Groups per band across every lane. */
  counts: Record<KpiBand, number>;
  /** Every group cell on the map — the denominator every chip prints. */
  total: number;
}

/** Count the map's cells by band. `unmeasured` is counted like any other band:
 *  absence is a quantity here, not a blank. */
export function bandCensus(overview: KpiProjectRollup[]): BandCensus {
  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, 0])) as Record<KpiBand, number>;
  let total = 0;
  for (const p of overview) {
    for (const g of p.groups) {
      counts[g.band] += 1;
      total += 1;
    }
  }
  return { counts, total };
}

/** Is this cell part of the active highlight? `null` = no highlight, so every
 *  cell is in. */
export function matchesHighlight(band: KpiBand, active: KpiBand | null): boolean {
  return active === null || band === active;
}

/** The group id a focus carries for a cell: real id, or the ungrouped key. */
export function focusGroupId(groupId: string | null): string {
  return groupId ?? UNGROUPED_KEY;
}
