// PROTOTYPE ROUND (spark council-readout), direction C - Bullet-chart table.
// The numbers the table draws, decided once: which member columns exist, how
// a score maps onto the ramp, how far an overall sits from the bar, and how a
// head press walks desc -> asc -> back to the queue's own order.
import type { SortDir, TableSort } from '@/features/shared/components/kit';

import type { PanelRow } from '../../protoModel';
import { FEATURE_V1 } from '../../../table/rubrics';

/**
 * Ramp edges for a member score: a score at or above an edge climbs one step.
 * The third edge IS the feature-v1 threshold (0.70), so steps 3-4 read "at the
 * bar" and 0-2 "below it" without a second colour.
 */
export const RAMP_EDGES = [0.4, 0.55, 0.7, 0.85] as const;

export function rampStep(score: number): number {
  let step = 0;
  for (const edge of RAMP_EDGES) if (score >= edge) step += 1;
  return step;
}

/** How an overall stands against its bar: over it, within reach, or far below. */
export type OverallTone = 'pass' | 'near' | 'far';

/** Within this distance under the bar an overall reads "near", not "far". */
const NEAR_BAND = 0.2;

export function overallTone(overall: number, threshold: number): OverallTone {
  if (overall >= threshold) return 'pass';
  if (threshold - overall <= NEAR_BAND) return 'near';
  return 'far';
}

/**
 * The member columns, in rubric order, as the union over every row's rubric,
 * so a feature row and an architecture row line their shared members up.
 */
export function memberColumns(rows: PanelRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const name of Object.keys(row.rubric.dimensions)) if (!out.includes(name)) out.push(name);
  return out.length > 0 ? out : Object.keys(FEATURE_V1.dimensions);
}

/**
 * The sort after a head press. The kit flips a column between its two
 * directions forever; here the press that would come back to the column's
 * opening direction clears the sort instead, so the queue's own order (hard
 * failures, floor hits, thinnest coverage first) is one press away.
 */
export function cycleSort<K extends string>(
  current: TableSort<K> | null,
  next: TableSort<K>,
  opening: SortDir | undefined,
): TableSort<K> | null {
  if (current && current.key === next.key && next.dir === opening) return null;
  return next;
}
