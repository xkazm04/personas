// Pure model behind the in-place Project › Group layer (kpi-strategic-map
// spark, WP4). No React here: the row order, the bullet scaling and the series
// shaping are the parts worth testing, and they are all functions of the
// overview rows + the lazily fetched measurements.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import { kpiTrack, kpiNormValue, type KpiTrack } from '../kpiMath';
import { bucketSeries, NOT_DIRECTLY_MEASURED, type SamplePoint, type TimeWindow } from '../kpiSample';
import { findGroup, type KpiBand, type KpiFocus, type KpiProjectRollup } from '../kpiOverviewModel';

/** The subject the layer is showing: one group, or the WHOLE project. */
export interface LayerSubject {
  projectLabel: string;
  /** null = every group in the project (the caller prints `layer_project_all`). */
  groupLabel: string | null;
  kpis: DevKpi[];
  measured: number;
  total: number;
  band: KpiBand;
}

/** Resolve the focus against the overview. Null = the project (or the group)
 *  is gone — a stale focus after a refetch, which the layer states plainly. */
export function resolveSubject(overview: KpiProjectRollup[], focus: KpiFocus): LayerSubject | null {
  const project = overview.find((p) => p.projectId === focus.projectId);
  if (!project) return null;
  if (focus.groupId === null) {
    return {
      projectLabel: project.label,
      groupLabel: null,
      kpis: project.groups.flatMap((g) => g.kpis),
      measured: project.measured,
      total: project.total,
      band: project.band,
    };
  }
  const group = findGroup(overview, focus);
  if (!group) return null;
  return {
    projectLabel: project.label,
    groupLabel: group.label,
    kpis: group.kpis,
    measured: group.measured,
    total: group.total,
    band: group.band,
  };
}

export interface BulletRow {
  kpi: DevKpi;
  track: KpiTrack;
}

/** Attention order: what is wrong, then what is fine, then what has nothing
 *  to say. `unmeasured` sorts LAST — absence is not a verdict. */
const TRACK_RANK: Record<KpiTrack, number> = {
  'off-track': 0,
  'on-track': 1,
  met: 2,
  unpaced: 3,
  unmeasured: 4,
};

export function sortBulletRows(kpis: DevKpi[]): BulletRow[] {
  return kpis
    .map((kpi) => ({ kpi, track: kpiTrack(kpi) }))
    .sort(
      (a, b) => TRACK_RANK[a.track] - TRACK_RANK[b.track] || a.kpi.name.localeCompare(b.kpi.name),
    );
}

export interface BulletScale {
  /** 0–100 of the bar's width, or null when the value is absent. */
  current: number | null;
  target: number | null;
  baseline: number | null;
}

/**
 * Zero-based bullet geometry: every mark is a share of
 * `max(current, target, baseline) * 1.1`, so the bar reads as MAGNITUDE and
 * the color carries the verdict (a 'down' KPI is not drawn upside down).
 * Null when there is no positive extent to scale against — the caller then
 * draws the hatched track with no fill rather than a zero-length bar.
 */
export function bulletScale(kpi: DevKpi): BulletScale | null {
  const vals = [kpi.current_value, kpi.target_value, kpi.baseline_value].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (vals.length === 0) return null;
  const max = Math.max(...vals) * 1.1;
  if (!Number.isFinite(max) || max <= 0) return null;
  const pct = (v: number | null) =>
    v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, (v / max) * 100));
  return { current: pct(kpi.current_value), target: pct(kpi.target_value), baseline: pct(kpi.baseline_value) };
}

/** Ids of the rows that actually have a reading — the only ones worth fetching
 *  measurements for. */
export function measuredIds(rows: BulletRow[]): string[] {
  return rows.filter((r) => r.track !== 'unmeasured').map((r) => r.kpi.id);
}

export interface PanelSeries {
  kpi: DevKpi;
  track: KpiTrack;
  points: SamplePoint[];
  /** Any measurement in this env was simulated / composed → drawn dashed. */
  simulated: boolean;
}

/** How many KPIs get their own mini chart before the rest fall to the table. */
export const MAX_PANELS = 12;

/**
 * One normalized series per row that has at least one point in the SHARED
 * window, in bullet-strip order. Buckets are capped at 8 per KPI and every
 * series is bucketed over the same window, so sibling panels are comparable.
 */
export function buildPanelSeries(
  rows: BulletRow[],
  trends: Record<string, DevKpiMeasurement[]>,
  window: TimeWindow | null,
  env: string,
): PanelSeries[] {
  if (!window) return [];
  const out: PanelSeries[] = [];
  for (const { kpi, track } of rows) {
    const ms = trends[kpi.id] ?? [];
    const points = bucketSeries(ms, 8, window, env)
      .map((p) => ({ t: p.t, v: kpiNormValue(kpi, p.v) }))
      .filter((p): p is SamplePoint => p.v != null);
    if (points.length === 0) continue;
    const simulated = ms.some(
      (m) => (m.env ?? 'production') === env && NOT_DIRECTLY_MEASURED.has(m.source),
    );
    out.push({ kpi, track, points, simulated });
  }
  return out;
}

export interface SparkCoord {
  x: number;
  y: number;
}

/** Sparkline coordinates on the SAME window and the same [-15, 115] band as
 *  the mini panels, so a table row and a panel cannot disagree. */
export function sparkCoords(
  points: SamplePoint[],
  window: TimeWindow,
  width = 96,
  height = 24,
): SparkCoord[] {
  const span = window.to - window.from || 1;
  return points.map((p) => ({
    x: Number((((p.t - window.from) / span) * width).toFixed(1)),
    y: Number((height - ((Math.max(-15, Math.min(115, p.v)) + 15) / 130) * (height - 4) - 2).toFixed(1)),
  }));
}
