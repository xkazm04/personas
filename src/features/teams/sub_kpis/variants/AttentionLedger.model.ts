// Pure model behind the Attention ledger (kpi-strategic-map spark, WP2). The
// ledger is a strategic brief: exceptions first, one ranked next move per
// project. Everything here is judgment over the measurement log, no React.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import { kpiNormValue, kpiTrack, type KpiTrack } from '../kpiMath';
import type { KpiProjectRollup } from '../kpiOverviewModel';
import { NOT_DIRECTLY_MEASURED, bucketSeries, measuredAtMs, type TimeWindow } from '../kpiSample';

/** The measurement read is bounded: at most this many KPI ids are fetched for
 *  the whole ledger, taken in project order. A fleet with thousands of KPIs
 *  must not turn one overview into an unbounded bulk read — the sections below
 *  the cap still render, they just carry no sparkline. */
export const LEDGER_ID_CAP = 400;

/** Ids of every KPI that has a reading, in project → group → list order. */
export function ledgerKpiIds(overview: KpiProjectRollup[], cap = LEDGER_ID_CAP): string[] {
  const out: string[] = [];
  for (const p of overview) {
    for (const g of p.groups) {
      for (const k of g.kpis) {
        if (k.current_value == null) continue;
        out.push(k.id);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

/** Real observations only: production channel, not simulated/composed, newest
 *  first. A simulated row never gets to speak for a state change. */
export function realPoints(ms: DevKpiMeasurement[] | undefined): DevKpiMeasurement[] {
  return (ms ?? [])
    .filter((m) => (m.env ?? 'production') === 'production' && !NOT_DIRECTLY_MEASURED.has(m.source))
    .filter((m) => Number.isFinite(measuredAtMs(m)))
    .sort((a, b) => measuredAtMs(b) - measuredAtMs(a));
}

export interface StateChange {
  kpi: DevKpi;
  /** The verdict the point BEFORE the newest one yields. */
  from: KpiTrack;
  /** The verdict the NEWEST production reading yields. */
  to: KpiTrack;
  /** `measured_at` of the newest reading, epoch ms. */
  at: number;
}

/**
 * KPIs whose newest production reading changed the verdict. Both verdicts are
 * computed by judging the KPI at each value (`kpiTrack`), so the change is the
 * same rule the rest of the app grades with — not a stored flag that can drift.
 * Arrivals at `off-track` sort first, then most recent. A KPI with fewer than
 * two real readings has no change to report and is skipped (never "stable").
 */
export function stateChanges(
  project: KpiProjectRollup,
  trends: Record<string, DevKpiMeasurement[]>,
  limit = 8,
): StateChange[] {
  const out: StateChange[] = [];
  for (const g of project.groups) {
    for (const kpi of g.kpis) {
      const pts = realPoints(trends[kpi.id]);
      if (pts.length < 2) continue;
      const to = kpiTrack({ ...kpi, current_value: pts[0]!.value });
      const from = kpiTrack({ ...kpi, current_value: pts[1]!.value });
      if (to === from) continue;
      out.push({ kpi, from, to, at: measuredAtMs(pts[0]!) });
    }
  }
  out.sort(
    (a, b) =>
      Number(b.to === 'off-track') - Number(a.to === 'off-track') || b.at - a.at,
  );
  return out.slice(0, limit);
}

/** The sparkline's fixed y-domain: the same 0–100 %-of-target axis every
 *  normalized KPI chart uses, with the clamp band `kpiNormValue` guarantees. */
export const SPARK_DOMAIN = { min: -15, max: 115 } as const;

/**
 * One KPI's sparkline values on the shared axis: bucketed over the ledger's
 * ONE window, normalized to % of target. Empty when the series carries no real
 * production observation or the KPI has no target to normalize against — the
 * caller then draws nothing, never a flat zero.
 */
export function sparkValues(
  kpi: DevKpi,
  ms: DevKpiMeasurement[] | undefined,
  window: TimeWindow | null,
  buckets = 8,
): number[] {
  const real = (ms ?? []).filter((m) => !NOT_DIRECTLY_MEASURED.has(m.source));
  if (real.length === 0) return [];
  return bucketSeries(real, buckets, window ?? undefined, 'production')
    .map((p) => kpiNormValue(kpi, p.v))
    .filter((v): v is number => v != null);
}

export interface SparkPoint {
  x: number;
  y: number;
}

/** Values → svg coordinates on the FIXED domain (so two sparklines side by
 *  side are comparable). A single value sits at the horizontal center. */
export function sparkPoints(values: number[], width = 96, height = 24): SparkPoint[] {
  const span = SPARK_DOMAIN.max - SPARK_DOMAIN.min;
  const inner = height - 4;
  return values.map((v, i) => {
    const frac = Math.max(0, Math.min(1, (v - SPARK_DOMAIN.min) / span));
    return {
      x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width,
      y: Number((height - 2 - frac * inner).toFixed(2)),
    };
  });
}

/** `points` attribute for the polyline form (3+ values). */
export function sparkPolyline(values: number[], width = 96, height = 24): string {
  return sparkPoints(values, width, height)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}
