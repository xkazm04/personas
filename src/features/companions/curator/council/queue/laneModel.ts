// The queue as Project lanes: the rows of one filter, each council's member
// marks read straight off the list projection (`CouncilSubjectState.dimensions`,
// so drawing the queue reads no run), the lanes by project in queue order, the
// member columns every lane shares, the ramp a score lands on, and each lane's
// own mean per member so "which project is weakest at robustness" is one
// strip to read.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { queueGroups } from '../bench/queueModel';
import { decidable } from '../councilRules';
import { FEATURE_V1, resolveRubric, type Rubric } from '../table/rubrics';
import type { SeatState } from '../table/runModel';

/** The queue's three views of one list: waiting on you, passed by the machine, decided. */
export type QueueFilter = 'waiting' | 'machine' | 'decided';

export const QUEUE_FILTERS: readonly QueueFilter[] = ['waiting', 'machine', 'decided'];

const GROUP_OF: Record<QueueFilter, 'yours' | 'machine' | 'decided'> = {
  waiting: 'yours',
  machine: 'machine',
  decided: 'decided',
};

/** One member's mark on a council's latest run. Null score is NOT MEASURED, never 0. */
export interface LaneMark {
  name: string;
  state: SeatState;
  score: number | null;
  floorHit: boolean;
}

export interface LaneRow {
  subject: CouncilSubjectState;
  rubric: Rubric;
  /** Every member the rubric names, in rubric order; one the run never reached is `not_run`. */
  marks: LaneMark[];
  /** Only lite rounds exist: readable, never decidable until a full council runs. */
  liteOnly: boolean;
  decidable: boolean;
  /** Items the latest run says must be addressed. */
  mustAddress: number;
}

const STATES = new Set<string>(['measured', 'carried', 'unmeasured', 'not_applicable']);

/** The rubric's members, in its order, from the projection's marks. */
export function marksOf(subject: CouncilSubjectState, rubric: Rubric): LaneMark[] {
  return Object.keys(rubric.dimensions).map((name) => {
    const d = subject.dimensions.find((x) => x.dimension === name);
    if (!d) return { name, state: 'not_run', score: null, floorHit: false };
    return {
      name,
      state: (STATES.has(d.state) ? d.state : 'unmeasured') as SeatState,
      score: d.score,
      floorHit: d.floorHit,
    };
  });
}

export function filterCounts(subjects: CouncilSubjectState[]): Record<QueueFilter, number> {
  const size = (key: string) => queueGroups(subjects).find((g) => g.key === key)?.rows.length ?? 0;
  return { waiting: size('yours'), machine: size('machine'), decided: size('decided') };
}

/** The rows of one filter, in the queue's own order (hard failures, floor hits, thinnest coverage, round, title). */
export function queueRows(subjects: CouncilSubjectState[], filter: QueueFilter): LaneRow[] {
  const group = queueGroups(subjects).find((g) => g.key === GROUP_OF[filter]);
  return (group?.rows ?? []).map((subject) => {
    // The projection carries no rubric version; the subject's kind names it.
    const { rubric } = resolveRubric(null, subject.kind);
    return {
      subject,
      rubric,
      marks: marksOf(subject, rubric),
      liteOnly: subject.mode === 'lite',
      decidable: decidable(subject),
      mustAddress: subject.mustAddressCount,
    };
  });
}

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
export function memberColumns(rows: LaneRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const name of Object.keys(row.rubric.dimensions)) if (!out.includes(name)) out.push(name);
  return out.length > 0 ? out : Object.keys(FEATURE_V1.dimensions);
}

/** One member of one lane, averaged over the councils that MEASURED it. */
export interface LaneMean {
  score: number | null;
  /** How many of the lane's councils measured it. */
  measured: number;
  /** How many councils the lane holds. */
  read: number;
}

export interface Lane {
  project: string;
  rows: LaneRow[];
  means: Record<string, LaneMean>;
}

function meanOf(rows: LaneRow[], member: string): LaneMean {
  let sum = 0;
  let measured = 0;
  for (const row of rows) {
    const mark = row.marks.find((m) => m.name === member);
    if (mark?.score == null) continue;
    sum += mark.score;
    measured += 1;
  }
  return { score: measured > 0 ? sum / measured : null, measured, read: rows.length };
}

function byProject(rows: LaneRow[]): Map<string, LaneRow[]> {
  const out = new Map<string, LaneRow[]>();
  for (const row of rows) {
    const lane = out.get(row.subject.projectName);
    if (lane) lane.push(row);
    else out.set(row.subject.projectName, [row]);
  }
  return out;
}

/** Lanes in the order their first council appears in the queue; rows keep the queue's order. */
export function lanesOf(rows: LaneRow[], members: string[]): Lane[] {
  return [...byProject(rows).entries()].map(([project, laneRows]) => ({
    project,
    rows: laneRows,
    means: Object.fromEntries(members.map((m) => [m, meanOf(laneRows, m)])),
  }));
}

/** The rows in the order the lanes draw them: what the arrows and `W` walk. */
export function laneOrder(rows: LaneRow[]): LaneRow[] {
  return [...byProject(rows).values()].flat();
}
