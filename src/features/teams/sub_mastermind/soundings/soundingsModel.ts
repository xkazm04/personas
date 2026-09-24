// Soundings — the pure half of the chart. Islands in, stations out: how urgent
// each project is, which band that puts it in, why, and what it relates to.
//
// Depth means URGENCY, not hierarchy. The formula is the one the owner reviewed
// in the contest prototype (docs/design/mastermind-soundings.md), kept verbatim
// so the chart means in the app what it meant in the review:
//
//   3 x alerts + risks + 2 if the release is late + 2 if an agent waits for
//   input + 3 if critical / 1 if warning, plus 1 if no monitoring is bound and
//   a quarter per gap (absent or unknown reading).
//
// No React, no DOM. Everything the view positions is derived from this file and
// soundingsGeometry.ts, so a position never drifts from the data behind it.
import { DIM_REGISTRY, type DimCategory, type DimKey } from '../lib/dimRegistry';
import type { DimNode, DimStatus, FleetNode, Island, IslandEdge } from '../lib/types';

/** 0 Surface (needs you) · 1 Shallows (not built) · 2 Mid-water (in progress) · 3 Deep (done). */
export type Band = 0 | 1 | 2 | 3;

export const BANDS: readonly Band[] = [0, 1, 2, 3];

/** Which band a single reading lives in. */
export const BAND_OF: Record<DimStatus, Band> = {
  alert: 0,
  risk: 0,
  absent: 1,
  unknown: 1,
  partial: 2,
  solid: 3,
};

/** The four lanes of a station, left to right. */
export const LANES: readonly DimCategory[] = ['runtime', 'delivery', 'agentic', 'product'];

/** A station's worst reading, for the buoy mark and the hairline above it. */
export type StationMark = 'alert' | 'risk' | 'calm';

export interface StationMetrics {
  alerts: number;
  risks: number;
  /** Absent or unknown readings. */
  gaps: number;
  /** The first fleet session waiting for the human, if any. */
  waiting: FleetNode | null;
  late: boolean;
  /** Buoy height. Higher = needs you more. */
  urgency: number;
  band: Band;
  mark: StationMark;
}

export interface Station {
  island: Island;
  /** Fixed horizontal slot. Never changes with urgency. */
  index: number;
  metrics: StationMetrics;
  /** A provisional island (its scan has not landed): drawn as a calm ghost. */
  ghost: boolean;
}

/** Band edges on the urgency scale. The chart's sounding figures 6, 2, 1 are these. */
export const BAND_EDGES = { surface: 6, shallows: 2, midwater: 1 } as const;

export function bandForUrgency(u: number): Band {
  if (u >= BAND_EDGES.surface) return 0;
  if (u >= BAND_EDGES.shallows) return 1;
  if (u >= BAND_EDGES.midwater) return 2;
  return 3;
}

function stateWeight(state: Island['state']): number {
  if (state === 'critical') return 3;
  if (state === 'warning') return 1;
  return 0;
}

function markOf(alerts: number, risks: number): StationMark {
  if (alerts > 0) return 'alert';
  if (risks > 0) return 'risk';
  return 'calm';
}

const CALM: StationMetrics = { alerts: 0, risks: 0, gaps: 0, waiting: null, late: false, urgency: 0, band: 3, mark: 'calm' };

export function stationMetrics(island: Island): StationMetrics {
  // A provisional island's every cell reads `unknown` and every number is a
  // placeholder (see Island.provisional). Scoring it would float an unmeasured
  // project into the Shallows on gaps it does not have.
  if (island.provisional) return CALM;
  let alerts = 0;
  let risks = 0;
  let gaps = 0;
  for (const n of island.nodes) {
    if (n.status === 'alert') alerts++;
    else if (n.status === 'risk') risks++;
    else if (n.status === 'absent' || n.status === 'unknown') gaps++;
  }
  const waiting = island.fleet.find((f) => f.state === 'awaiting_input') ?? null;
  const late = Boolean(island.ship?.late);
  const score = 3 * alerts + risks + (late ? 2 : 0) + (waiting ? 2 : 0) + stateWeight(island.state);
  const urgency = score + (island.monitorErrors === null ? 1 : 0) + 0.25 * gaps;
  return { alerts, risks, gaps, waiting, late, urgency, band: bandForUrgency(urgency), mark: markOf(alerts, risks) };
}

/** Stations in their fixed order: by project name, so a position means the same
 *  project every time the owner comes back. */
export function buildStations(islands: readonly Island[]): Station[] {
  return [...islands]
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
    .map((island, index) => ({ island, index, metrics: stationMetrics(island), ghost: Boolean(island.provisional) }));
}

/** Station indices from most to least urgent; ties keep their fixed order and
 *  ghosts sink to the end. `rank[0]` is the project that needs the owner first. */
export function rankStations(stations: readonly Station[]): number[] {
  return stations
    .map((s) => s.index)
    .sort((a, b) => {
      const sa = stations[a]!;
      const sb = stations[b]!;
      if (sa.ghost !== sb.ghost) return sa.ghost ? 1 : -1;
      return sb.metrics.urgency - sa.metrics.urgency || a - b;
    });
}

export type ReasonKind = 'alerts' | 'stalled' | 'critical' | 'late' | 'waiting' | 'risks' | 'unbound';

export interface Reason {
  kind: ReasonKind;
  /** How much the reason adds to the urgency — the sort key. */
  weight: number;
  /** Alerts / risks count. */
  count?: number;
  /** The late milestone, or the waiting session. */
  name?: string;
}

/** The (at most three) heaviest reasons a station floats where it does. */
export function stationReasons(station: Station): Reason[] {
  const { island, metrics: m } = station;
  if (station.ghost) return [];
  const out: Reason[] = [];
  if (m.alerts) out.push({ kind: 'alerts', weight: 3 * m.alerts, count: m.alerts });
  if (island.state === 'critical') out.push({ kind: island.lifecycle === 'stalled' ? 'stalled' : 'critical', weight: 3 });
  if (m.late && island.ship?.next) out.push({ kind: 'late', weight: 2, name: island.ship.next });
  if (m.waiting) out.push({ kind: 'waiting', weight: 2, name: m.waiting.label });
  if (m.risks) out.push({ kind: 'risks', weight: 1, count: m.risks });
  if (island.monitorErrors === null) out.push({ kind: 'unbound', weight: 0.9 });
  return out.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

/** Relations touching station `i`, as the other station's index (deduped, in order). */
export function relatedStations(i: number, edges: readonly IslandEdge[], indexOf: ReadonlyMap<string, number>): number[] {
  const out = new Set<number>();
  for (const e of edges) {
    const a = indexOf.get(e.from);
    const b = indexOf.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (a === i) out.add(b);
    else if (b === i) out.add(a);
  }
  return [...out].sort((x, y) => x - y);
}

export function edgeBetween(a: string, b: string, edges: readonly IslandEdge[]): IslandEdge | null {
  return edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)) ?? null;
}

/** Edges whose both ends are on the chart (a hidden project drops its currents). */
export function visibleEdges(edges: readonly IslandEdge[], indexOf: ReadonlyMap<string, number>): IslandEdge[] {
  return edges.filter((e) => indexOf.has(e.from) && indexOf.has(e.to));
}

export function categoryOf(key: DimKey): DimCategory {
  return DIM_REGISTRY[key].category;
}

/** The reading a freshly opened station focuses: the most urgent one. */
export function topReading(island: Island): DimKey | null {
  let best: DimNode | null = null;
  for (const n of island.nodes) {
    if (!best) { best = n; continue; }
    const d = BAND_OF[n.status] - BAND_OF[best.status];
    if (d < 0 || (d === 0 && n.status === 'alert' && best.status !== 'alert')) best = n;
  }
  return best?.key ?? null;
}

/** Solid readings over all readings in one lane, for the lane footer. */
export function laneScore(island: Island, lane: DimCategory): { solid: number; total: number } {
  const nodes = island.nodes.filter((n) => categoryOf(n.key) === lane);
  return { solid: nodes.filter((n) => n.status === 'solid').length, total: nodes.length };
}

/** Whole days a target date lies in the past (0 when it is today or ahead). */
export function daysLate(targetDate: string | null | undefined, now: number): number {
  if (!targetDate) return 0;
  const [y, m, d] = targetDate.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.max(0, Math.round((now - Date.UTC(y, m - 1, d)) / 86_400_000));
}
