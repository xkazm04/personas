// Pure model behind the Project grid (kpi-strategic-map spark, WP2). Small
// multiples only work when every card is built the same way from the same
// numbers, so the share split and the coverage series live here — testable,
// React-free, and shared by all cards.
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

import type { KpiProjectRollup } from '../kpiOverviewModel';
import { NOT_DIRECTLY_MEASURED, measuredAtMs, type TimeWindow } from '../kpiSample';

/** The grid's measurement read is bounded to this many KPI ids across ALL
 *  cards, taken in project order: a fleet-sized overview must not fan out into
 *  an unbounded bulk read. Cards past the cap render without a coverage line. */
export const GRID_ID_CAP = 400;

/** Buckets in the coverage sparkline, and the window it always spans. */
export const COVERAGE_BUCKETS = 8;
export const COVERAGE_DAYS = 30;

/** Measured KPI ids per project plus the flat list to fetch, capped. */
export function gridKpiIds(
  overview: KpiProjectRollup[],
  cap = GRID_ID_CAP,
): { byProject: Record<string, string[]>; all: string[] } {
  const byProject: Record<string, string[]> = {};
  const all: string[] = [];
  for (const p of overview) {
    const ids: string[] = [];
    for (const g of p.groups) {
      for (const k of g.kpis) {
        if (k.current_value == null) continue;
        if (all.length >= cap) break;
        ids.push(k.id);
        all.push(k.id);
      }
    }
    byProject[p.projectId] = ids;
  }
  return { byProject, all };
}

export type StackKey = 'met' | 'onTrack' | 'offTrack' | 'unpaced' | 'unmeasured';

export interface StackSegment {
  key: StackKey;
  count: number;
  /** Share of the project's TOTAL KPIs, 0–100 — so the bars are comparable. */
  pct: number;
}

/**
 * The stacked bar's segments, share-of-total so two cards' bars mean the same
 * thing. `unmeasured` is total − measured and is drawn hatched by the caller,
 * never as a colored fill; `unpaced` is measured-but-no-verdict and gets the
 * muted tone. Zero-count segments are omitted.
 */
export function stackShares(p: KpiProjectRollup): StackSegment[] {
  const unmeasured = Math.max(0, p.total - p.measured);
  const raw: Array<[StackKey, number]> = [
    ['met', p.met],
    ['onTrack', p.onTrack],
    ['offTrack', p.offTrack],
    ['unpaced', p.unpaced],
    ['unmeasured', unmeasured],
  ];
  return raw
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count, pct: p.total === 0 ? 0 : (count / p.total) * 100 }));
}

/** Real observations only (production channel, not simulated/composed). */
function realStamps(ms: DevKpiMeasurement[] | undefined): number[] {
  return (ms ?? [])
    .filter((m) => (m.env ?? 'production') === 'production' && !NOT_DIRECTLY_MEASURED.has(m.source))
    .map(measuredAtMs)
    .filter((t) => Number.isFinite(t));
}

/**
 * Share of the project's KPIs (denominator = `total`, the honest one) that had
 * a production reading at or before each bucket end over the SHARED window.
 * Values are 0–1 and monotonic in practice; an empty project yields an empty
 * series so the caller draws nothing rather than a flat zero line.
 */
export function coverageSeries(
  ids: string[],
  trends: Record<string, DevKpiMeasurement[]>,
  total: number,
  window: TimeWindow,
  buckets = COVERAGE_BUCKETS,
): number[] {
  if (total <= 0 || buckets <= 0) return [];
  const firsts = ids
    .map((id) => {
      const stamps = realStamps(trends[id]);
      return stamps.length === 0 ? null : Math.min(...stamps);
    })
    .filter((t): t is number => t != null);
  if (firsts.length === 0) return [];
  const width = (window.to - window.from) / buckets;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const end = window.from + (i + 1) * width;
    const seen = firsts.filter((t) => t <= end).length;
    out.push(seen / total);
  }
  return out;
}

/** The window every coverage sparkline in the grid shares: the last N days. */
export function coverageWindow(now: number, days = COVERAGE_DAYS): TimeWindow {
  return { from: now - days * 86_400_000, to: now };
}

export interface GridPoint {
  x: number;
  y: number;
}

/** Series → svg coordinates on the FIXED [0,1] y-domain (viewBox units). */
export function coveragePoints(values: number[], width = 100, height = 28): GridPoint[] {
  const inner = height - 2;
  return values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : Number(((i / (values.length - 1)) * width).toFixed(2)),
    y: Number((height - 1 - Math.max(0, Math.min(1, v)) * inner).toFixed(2)),
  }));
}

/** `d` for the filled area under the coverage line ('' when nothing to draw). */
export function coverageArea(values: number[], width = 100, height = 28): string {
  const pts = coveragePoints(values, width, height);
  if (pts.length < 2) return '';
  const line = pts.map((p) => `${p.x} ${p.y}`).join(' L ');
  return `M ${pts[0]!.x} ${height} L ${line} L ${pts[pts.length - 1]!.x} ${height} Z`;
}

/** `points` for the coverage polyline ('' when fewer than 2 points — a single
 *  reading is drawn as a dot, never as a trend). */
export function coverageLine(values: number[], width = 100, height = 28): string {
  const pts = coveragePoints(values, width, height);
  return pts.length < 2 ? '' : pts.map((p) => `${p.x},${p.y}`).join(' ');
}
