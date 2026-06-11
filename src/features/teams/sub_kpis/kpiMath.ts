// Shared KPI math — the single source of truth for "is this KPI off-track?"
// (the same pace-based rule the P4 derivation subscription and §10 cert use).
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

export type KpiTrack = 'on-track' | 'off-track' | 'met' | 'unmeasured';

/**
 * Pace-based off-track test. With a target_date: expected =
 * baseline + (target − baseline) × elapsed/total; off-track when `current`
 * lags expected by more than `tolerance` (default 10% of the span) in the
 * KPI's direction. Without a date: simply which side of the target the
 * current value sits on.
 */
export function kpiTrack(kpi: DevKpi, toleranceFrac = 0.1): KpiTrack {
  const { current_value: cur, target_value: target, baseline_value: baseline, direction } = kpi;
  if (cur == null) return 'unmeasured';
  if (target == null) return 'on-track';
  const better = direction === 'down' ? cur <= target : cur >= target;
  if (better) return 'met';

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
