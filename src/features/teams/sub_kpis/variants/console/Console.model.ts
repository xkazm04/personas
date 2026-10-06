// THE SPINE - every KPI in scope as one ordered sequence, and a cursor on it.
//
// Why a sequence rather than a hierarchy. The estate is already ordered: the
// module's own `sortByAttention` / `sortKpisByAttention` rank places and then
// KPIs by what a human could do about them today, and every surface in the
// module then throws that ordering away by re-grouping it into a picture. If
// the ordering is right - and it is the thing the kpi-descent contest settled
// on - then the most useful object on the page is not a map of 1,044 KPIs but
// the FIRST ONE, with a dial that walks to the second.
//
// So this derivation flattens the estate once, keeps the project and group
// each tick came from so a plate can say where it is and a descent still
// resolves, and records the project boundaries so a cursor can jump by
// project instead of stepping 721 times.
//
// Pure: no React, no store, no i18n.
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { kpiTrack, type KpiTrack } from '../../kpiMath';
import { ageDays, isStale, type Estate } from '../../estate/kpiEstate';
import { UNGROUPED_KEY } from '../../kpiOverviewModel';

export interface SpineTick {
  kpi: DevKpi;
  track: KpiTrack;
  stale: boolean;
  /** Whole days since the newest reading; null when never read. */
  age: number | null;
  projectId: string;
  projectLabel: string;
  /** `UNGROUPED_KEY` for the project's ungrouped cell, so a focus resolves. */
  groupId: string;
  groupLabel: string;
}

/** One project's run of consecutive ticks - what a jump key moves between. */
export interface SpineSegment {
  projectId: string;
  label: string;
  /** Index of this segment's first tick. */
  start: number;
  count: number;
}

export interface Spine {
  ticks: SpineTick[];
  segments: SpineSegment[];
}

/**
 * The estate, flattened in the order it is already ranked: projects
 * worst-first, and inside each project its groups worst-first and their KPIs
 * worst-first. Nothing is capped - the whole estate is the sequence, which is
 * the only way a position readout can honestly say "3 of 1,044".
 */
export function buildSpine(estate: Estate): Spine {
  const ticks: SpineTick[] = [];
  const segments: SpineSegment[] = [];
  for (const project of estate.projects) {
    const start = ticks.length;
    for (const group of project.groups) {
      for (const kpi of group.kpis) {
        ticks.push({
          kpi,
          track: kpiTrack(kpi),
          stale: isStale(kpi, estate.now),
          age: ageDays(kpi, estate.now) == null ? null : Math.round(ageDays(kpi, estate.now)!),
          projectId: project.projectId,
          projectLabel: project.label,
          groupId: group.groupId ?? UNGROUPED_KEY,
          groupLabel: group.label,
        });
      }
    }
    if (ticks.length > start) {
      segments.push({ projectId: project.projectId, label: project.label, start, count: ticks.length - start });
    }
  }
  return { ticks, segments };
}

/** Move the cursor by `delta`, clamped. Clamped rather than wrapped on
 *  purpose: the sequence is a RANKING, so running off the end at the least
 *  urgent KPI must not silently return you to the most urgent one. */
export function stepCursor(spine: Spine, at: number, delta: number): number {
  if (spine.ticks.length === 0) return 0;
  return Math.max(0, Math.min(spine.ticks.length - 1, at + delta));
}

/**
 * Jump to the first tick of the next / previous project. From inside a
 * segment, `-1` goes to that segment's own first tick before it goes to the
 * one before it, which is what makes the key usable: one press takes you to
 * the top of where you are.
 */
export function jumpSegment(spine: Spine, at: number, delta: 1 | -1): number {
  const i = segmentIndexAt(spine, at);
  if (i < 0) return at;
  const here = spine.segments[i]!;
  if (delta === -1 && at > here.start) return here.start;
  const next = spine.segments[i + delta];
  return next ? next.start : at;
}

/** Which segment holds `at`, or -1 on an empty spine. */
export function segmentIndexAt(spine: Spine, at: number): number {
  for (let i = spine.segments.length - 1; i >= 0; i -= 1) {
    if (at >= spine.segments[i]!.start) return i;
  }
  return spine.segments.length > 0 ? 0 : -1;
}

/**
 * The TRAVEL: where the current reading sits on the baseline -> target line,
 * UNCLAMPED past the ends so an overshoot and a regression below baseline are
 * both visible as themselves. `kpiProgressPct` clamps to 0..100, which is
 * right for a progress bar and wrong for a plate whose whole job is to show
 * the reading in relation to the two numbers that frame it.
 *
 * `null` when the three numbers do not frame anything: no reading, no target,
 * or a baseline equal to the target.
 */
export interface Travel {
  baseline: number;
  current: number;
  target: number;
  /** Percent of the way from baseline to target; may be < 0 or > 100. */
  pct: number;
  /** The reading is past the target. */
  overshot: boolean;
  /** The reading is on the wrong side of the baseline. */
  regressed: boolean;
}

export function travelOf(kpi: DevKpi): Travel | null {
  const { current_value: cur, target_value: target, baseline_value: baseline } = kpi;
  if (cur == null || target == null || baseline == null || target === baseline) return null;
  const pct = ((cur - baseline) / (target - baseline)) * 100;
  return {
    baseline, current: cur, target,
    pct: Math.round(pct * 10) / 10,
    overshot: pct > 100,
    regressed: pct < 0,
  };
}
