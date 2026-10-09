// PROTOTYPE ROUND (spark council-readout), direction D - Project lanes.
// The heatmap's model: lanes by project in queue order, the member columns
// every lane shares, the ramp a score lands on, and each lane's own mean per
// member so "which project is weakest at robustness" is one strip to read.
import type { PanelRow } from '../../protoModel';
import { FEATURE_V1 } from '../../../table/rubrics';

/**
 * Ramp edges: a score at or above an edge climbs one step. The third edge is
 * the feature-v1 threshold (0.70), so steps 3-4 are "at the bar" and 0-2 are
 * below it, read off one sequential hue.
 */
export const RAMP_EDGES = [0.4, 0.55, 0.7, 0.85] as const;

export function rampStep(score: number): number {
  let step = 0;
  for (const edge of RAMP_EDGES) if (score >= edge) step += 1;
  return step;
}

export type OverallTone = 'pass' | 'near' | 'far';

/** Within this distance under the bar an overall reads "near", not "far". */
const NEAR_BAND = 0.2;

export function overallTone(overall: number, threshold: number): OverallTone {
  if (overall >= threshold) return 'pass';
  if (threshold - overall <= NEAR_BAND) return 'near';
  return 'far';
}

/** The member columns: the union of every row's rubric, in rubric order. */
export function memberColumns(rows: PanelRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const name of Object.keys(row.rubric.dimensions)) if (!out.includes(name)) out.push(name);
  return out.length > 0 ? out : Object.keys(FEATURE_V1.dimensions);
}

/** A member's column head: a short word that fits a heat cell. */
export const MEMBER_SHORT: Record<string, string> = {
  value: 'Value',
  craft: 'Craft',
  rivalry: 'Rival',
  robustness: 'Robust',
  economics: 'Econ',
  reversibility: 'Revers',
};

export function memberName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One member of one lane, averaged over the councils that MEASURED it. */
export interface LaneMean {
  score: number | null;
  /** How many of the lane's read councils measured it. */
  measured: number;
  /** How many of the lane's councils have been read at all. */
  read: number;
}

export interface Lane {
  project: string;
  rows: PanelRow[];
  means: Record<string, LaneMean>;
}

function meanOf(rows: PanelRow[], member: string): LaneMean {
  let sum = 0;
  let measured = 0;
  let read = 0;
  for (const row of rows) {
    if (!row.seats) continue;
    read += 1;
    const seat = row.seats.find((s) => s.name === member);
    if (seat?.score == null) continue;
    sum += seat.score;
    measured += 1;
  }
  return { score: measured > 0 ? sum / measured : null, measured, read };
}

/** Lanes in the order their first council appears in the queue; rows keep the queue's order. */
export function lanesOf(rows: PanelRow[], members: string[]): Lane[] {
  const byProject = new Map<string, PanelRow[]>();
  for (const row of rows) {
    const key = row.subject.projectName;
    const lane = byProject.get(key);
    if (lane) lane.push(row);
    else byProject.set(key, [row]);
  }
  return [...byProject.entries()].map(([project, laneRows]) => ({
    project,
    rows: laneRows,
    means: Object.fromEntries(members.map((m) => [m, meanOf(laneRows, m)])),
  }));
}
