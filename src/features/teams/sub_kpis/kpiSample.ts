// Sampling the measurement series for the strategic views (kpi-strategic-map
// spark). The store holds the newest 30 points per KPI; charts that sit side
// by side must share ONE window and ONE grain, so every series is bucketed
// into equal time buckets over a window computed from the set, not per KPI
// (registry: scale-and-axis-design, micro-visualizations). A bucket with no
// measurement yields NO point — a gap, never a zero.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { kpiTrack } from './kpiMath';

export interface TimeWindow {
  from: number;
  to: number;
}

export interface SamplePoint {
  /** Bucket end, epoch ms. */
  t: number;
  v: number;
}

/** Sources that are not real observations (drawn dashed, never as truth). */
export const NOT_DIRECTLY_MEASURED = new Set(['simulation', 'ai-compose']);

export function measuredAtMs(m: DevKpiMeasurement): number {
  return new Date(m.measured_at.replace(' ', 'T')).getTime();
}

/** One window spanning every listed series (ids missing from `trends` are
 *  ignored). Null when no series has a finite timestamp. */
export function sharedWindow(
  trends: Record<string, DevKpiMeasurement[]>,
  ids: string[],
  env?: string,
): TimeWindow | null {
  let from = Infinity;
  let to = -Infinity;
  for (const id of ids) {
    for (const m of trends[id] ?? []) {
      if (env && (m.env ?? 'production') !== env) continue;
      const t = measuredAtMs(m);
      if (!Number.isFinite(t)) continue;
      if (t < from) from = t;
      if (t > to) to = t;
    }
  }
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

/**
 * Bucket one series (any order) into `buckets` equal-width slots over
 * `window` (defaults to the series' own span). Each slot keeps its LAST
 * value; empty slots are omitted. A single-point series returns that point.
 */
export function bucketSeries(
  ms: DevKpiMeasurement[],
  buckets = 8,
  window?: TimeWindow,
  env?: string,
): SamplePoint[] {
  const pts = ms
    .filter((m) => !env || (m.env ?? 'production') === env)
    .map((m) => ({ t: measuredAtMs(m), v: m.value }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return [];
  const w = window ?? { from: pts[0]!.t, to: pts[pts.length - 1]!.t };
  const span = w.to - w.from;
  if (span <= 0 || buckets <= 1) return [pts[pts.length - 1]!];
  const width = span / buckets;
  const slots = new Map<number, SamplePoint>();
  for (const p of pts) {
    if (p.t < w.from || p.t > w.to) continue;
    const i = Math.min(buckets - 1, Math.floor((p.t - w.from) / width));
    slots.set(i, { t: w.from + (i + 1) * width, v: p.v });
  }
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

export interface WeeklyState {
  /** The instant of Monday 00:00 in the series' zone (label it in that zone). */
  week: number;
  met: number;
  onTrack: number;
  offTrack: number;
  /** KPIs with at least one production measurement at or before week end. */
  measured: number;
  /** The current, still-open week. */
  partial: boolean;
}

/** The zone whose calendar decides which week a reading falls in. KPIs carry
 *  no zone of their own, so the operator's is named explicitly and passed
 *  through — never inferred inside the arithmetic. */
export function operatorTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const DAY_MS = 86_400_000;

/** Wall-clock parts of `ms` in `timeZone` (24h, en-CA gives YYYY-MM-DD). */
function wallClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { date: Date.UTC(get('year'), get('month') - 1, get('day')), hour: get('hour'), minute: get('minute') };
}

/** The real instant of 00:00 on Monday of the week `ms` falls in, on the
 *  calendar of `timeZone` — ONE zone decides keys, buckets and labels. */
export function mondayOf(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const monday = w.date - ((new Date(w.date).getUTCDay() + 6) % 7) * DAY_MS; // calendar date as UTC key
  // Instant of that calendar midnight: subtract the wall-clock offset observed
  // at the key instant (the date it shows may be the day before, so realign).
  const at = wallClock(monday, timeZone);
  const wallMs = (at.date - monday) + at.hour * 3_600_000 + at.minute * 60_000;
  return monday - wallMs;
}

/**
 * Weekly state distribution of a KPI set, rebuilt from the append-only
 * measurement log: for each of the last `weeks` weeks, every KPI's latest
 * production value at or before the week's end is judged with `kpiTrack`.
 * A week where no KPI had any value yet has `measured: 0` — callers draw a
 * gap there, never a zero. `now` is injectable for tests.
 */
export function weeklyStateSeries(
  kpis: DevKpi[],
  trends: Record<string, DevKpiMeasurement[]>,
  weeks = 12,
  now = Date.now(),
  timeZone = operatorTimeZone(),
): WeeklyState[] {
  const WEEK = 7 * 86_400_000;
  const thisMonday = mondayOf(now, timeZone);
  const series: Array<{ kpi: DevKpi; pts: SamplePoint[] }> = kpis.map((kpi) => ({
    kpi,
    pts: (trends[kpi.id] ?? [])
      .filter((m) => (m.env ?? 'production') === 'production' && !NOT_DIRECTLY_MEASURED.has(m.source))
      .map((m) => ({ t: measuredAtMs(m), v: m.value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t),
  }));
  const out: WeeklyState[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = thisMonday - i * WEEK;
    const end = week + WEEK;
    const row: WeeklyState = { week, met: 0, onTrack: 0, offTrack: 0, measured: 0, partial: i === 0 };
    for (const { kpi, pts } of series) {
      let last: SamplePoint | undefined;
      for (const p of pts) { if (p.t < end) last = p; else break; }
      if (!last) continue;
      row.measured += 1;
      const t = kpiTrack({ ...kpi, current_value: last.v });
      if (t === 'met') row.met += 1;
      else if (t === 'on-track') row.onTrack += 1;
      else if (t === 'off-track') row.offTrack += 1;
    }
    out.push(row);
  }
  return out;
}
