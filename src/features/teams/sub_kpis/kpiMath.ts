// Shared KPI math — the single source of truth for "is this KPI off-track?"
// (the same pace-based rule the P4 derivation subscription and §10 cert use).
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

export type KpiTrack = 'on-track' | 'off-track' | 'met' | 'unmeasured';

/** Why a KPI is off-track — the three direction-aware triggers, in priority
 *  order. `null` when it isn't off-track. Drives the "what the system will do
 *  about this" copy in the Factory console + the Goals KPI cross-reference. */
export type OffTrackReason = 'floor' | 'crit' | 'pace';

/**
 * Mirror of `engine/kpi_derivation.rs::kpi_floor_breached`. A measured business
 * metric (traffic/value, higher-is-better) sitting at or below zero is treated
 * as maximally off-track — there is no pace toward a target when the floor
 * itself is breached ("0 users beats 100% coverage").
 */
export function kpiFloorBreached(kpi: DevKpi): boolean {
  return (
    (kpi.category === 'traffic' || kpi.category === 'value') &&
    kpi.direction === 'up' &&
    kpi.current_value != null &&
    kpi.current_value <= 0
  );
}

/**
 * The single source of truth for "is this KPI off-track?" — the exact port of
 * `engine/kpi_derivation.rs::kpi_is_off_track` (keep the two in sync). Off-track
 * fires on ANY of three direction-aware tests, checked in order:
 *   1. floor breach (`kpiFloorBreached`);
 *   2. the user's calibrated CRITICAL line (`crit_at`) being crossed — the
 *      Factory console lever, honored independently of pace;
 *   3. pace lag — with a target_date + baseline, `current` lags the linearly-
 *      paced expectation by more than `tolerance` (default 10% of the span).
 * A met target wins over every threshold/pace verdict.
 */
export function kpiTrack(kpi: DevKpi, toleranceFrac = 0.1): KpiTrack {
  const { current_value: cur, target_value: target, baseline_value: baseline, direction } = kpi;
  if (cur == null) return 'unmeasured';
  if (kpiFloorBreached(kpi)) return 'off-track';
  if (target == null) return 'on-track';
  const better = direction === 'down' ? cur <= target : cur >= target;
  if (better) return 'met';

  // The user's hard CRITICAL line — off-track regardless of pace, the moment
  // `current` crosses it. Null until the user calibrates it in the console.
  if (kpi.crit_at != null) {
    const breached = direction === 'down' ? cur >= kpi.crit_at : cur <= kpi.crit_at;
    if (breached) return 'off-track';
  }

  if (kpi.target_date && baseline != null) {
    const start = new Date(kpi.created_at.replace(' ', 'T')).getTime();
    const end = new Date(kpi.target_date.replace(' ', 'T')).getTime();
    const now = Date.now();
    if (end > start) {
      const frac = Math.min(1, Math.max(0, (now - start) / (end - start)));
      const span = target - baseline;
      const expected = baseline + span * frac;
      const tolerance = Math.abs(span) * toleranceFrac;
      const lagging = direction === 'down' ? cur > expected + tolerance : cur < expected - tolerance;
      return lagging ? 'off-track' : 'on-track';
    }
  }
  // No pace info — not met yet, but not provably lagging either.
  return 'on-track';
}

/** Which of the three triggers put this KPI off-track (null when on-track/met/
 *  unmeasured). Same priority order as `kpiTrack`, so the reason the UI shows
 *  matches the trigger the derivation loop will actually fire on. */
export function kpiOffTrackReason(kpi: DevKpi): OffTrackReason | null {
  if (kpiTrack(kpi) !== 'off-track') return null;
  if (kpiFloorBreached(kpi)) return 'floor';
  const cur = kpi.current_value;
  if (cur != null && kpi.crit_at != null) {
    const breached = kpi.direction === 'down' ? cur >= kpi.crit_at : cur <= kpi.crit_at;
    if (breached) return 'crit';
  }
  return 'pace';
}

/** Percent progress from baseline toward target (clamped 0–100), or null. */
export function kpiProgressPct(kpi: DevKpi): number | null {
  const { current_value: cur, target_value: target, baseline_value: baseline } = kpi;
  if (cur == null || target == null || baseline == null || target === baseline) return null;
  return Math.round(Math.min(1, Math.max(0, (cur - baseline) / (target - baseline))) * 100);
}

/** SVG polyline points for a compact measurement sparkline (oldest → newest). */
export function sparklinePoints(
  measurements: DevKpiMeasurement[],
  width = 96,
  height = 24,
): string {
  if (measurements.length < 2) return '';
  const chrono = [...measurements].reverse(); // list is newest-first
  const values = chrono.map((m) => m.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return chrono
    .map((m, i) => {
      const x = (i / (chrono.length - 1)) * width;
      const y = height - ((m.value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Inputs for the plain-language pace sentence (component interpolates i18n). */
export interface PaceDescriptor {
  track: KpiTrack;
  /** 0–100 progress from baseline toward target, when computable. */
  progressPct: number | null;
  /** Days until the milestone (negative = overdue), when a date exists. */
  daysLeft: number | null;
}

export function paceDescriptor(kpi: DevKpi): PaceDescriptor {
  const track = kpiTrack(kpi);
  const progressPct = kpiProgressPct(kpi);
  let daysLeft: number | null = null;
  if (kpi.target_date) {
    const end = new Date(kpi.target_date.replace(' ', 'T')).getTime();
    if (Number.isFinite(end)) daysLeft = Math.round((end - Date.now()) / 86_400_000);
  }
  return { track, progressPct, daysLeft };
}
