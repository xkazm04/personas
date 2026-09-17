// The pure model behind the State River (kpi-strategic-map spark, WP3).
// Two jobs, both honesty rules the chart cannot be trusted to keep on its own:
//
//  1. A week where NOTHING was measured is a GAP, not a zero. `riverPoints`
//     maps such a week's three stacked values to `null`, and the chart never
//     sets `connectNulls` — so the river simply is not there for that week.
//  2. Sibling charts share ONE scale. `sharedRiverMax` is the max stacked
//     count across EVERY project's series, so a 3-KPI project is not drawn as
//     tall as a 300-KPI one (registry: scale-and-axis-design).
import type { KpiProjectRollup } from '../kpiOverviewModel';
import type { WeeklyState } from '../kpiSample';

/** One week of one project's river. Null = no reading that week. */
export interface RiverPoint {
  week: number;
  met: number | null;
  onTrack: number | null;
  offTrack: number | null;
  measured: number;
  partial: boolean;
}

/**
 * How many KPI measurement series the whole variant will pull at once. The
 * river draws every project on screen, so an unbounded fan-out would issue a
 * bulk read over the entire estate on first paint. 400 is the budget; projects
 * past it render their header and say so instead of drawing an empty chart.
 */
export const RIVER_ID_CAP = 400;

export function riverPoints(states: WeeklyState[]): RiverPoint[] {
  return states.map((s) => ({
    week: s.week,
    met: s.measured === 0 ? null : s.met,
    onTrack: s.measured === 0 ? null : s.onTrack,
    offTrack: s.measured === 0 ? null : s.offTrack,
    measured: s.measured,
    partial: s.partial,
  }));
}

/** Tallest stacked column in one project's river (0 when every week is a gap). */
export function stackedMax(points: RiverPoint[]): number {
  let max = 0;
  for (const p of points) {
    if (p.met == null) continue;
    const sum = (p.met ?? 0) + (p.onTrack ?? 0) + (p.offTrack ?? 0);
    if (sum > max) max = sum;
  }
  return max;
}

/** The ONE y-axis top every project's chart is drawn against. Never below 1,
 *  so an all-gap portfolio still renders a sane axis instead of [0, 0]. */
export function sharedRiverMax(series: RiverPoint[][]): number {
  let max = 0;
  for (const s of series) {
    const m = stackedMax(s);
    if (m > max) max = m;
  }
  return Math.max(1, max);
}

/** True when at least one week carries a reading — otherwise the slot says
 *  "no readings in this window" rather than drawing empty axes. */
export function hasReadings(points: RiverPoint[]): boolean {
  return points.some((p) => p.measured > 0);
}

/** Week start of the still-open week, for the partial-week marker. */
export function partialWeekStart(points: RiverPoint[]): number | null {
  return points.find((p) => p.partial)?.week ?? null;
}

export interface RiverPlan {
  /** Every id to fetch, in overview order, capped at `cap`. */
  ids: string[];
  /** projectId → its measurable KPI ids (only for projects inside the cap). */
  byProject: Record<string, string[]>;
  /** Projects dropped by the cap — they are LABELED, never drawn empty. */
  notLoaded: string[];
}

/**
 * Which KPIs the river asks for. Only KPIs that already carry a
 * `current_value` can have a series worth charting, so unmeasured ones are
 * never requested. A project is taken WHOLE or not at all: half a project's
 * KPIs would draw a river that silently understates its own counts.
 */
export function planRiverIds(overview: KpiProjectRollup[], cap = RIVER_ID_CAP): RiverPlan {
  const ids: string[] = [];
  const byProject: Record<string, string[]> = {};
  const notLoaded: string[] = [];
  for (const p of overview) {
    const mine = p.groups.flatMap((g) => g.kpis).filter((k) => k.current_value != null).map((k) => k.id);
    if (mine.length === 0) {
      byProject[p.projectId] = [];
      continue;
    }
    if (ids.length + mine.length > cap) {
      notLoaded.push(p.projectId);
      continue;
    }
    ids.push(...mine);
    byProject[p.projectId] = mine;
  }
  return { ids, byProject, notLoaded };
}
