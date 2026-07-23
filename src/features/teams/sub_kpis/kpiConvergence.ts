// Sim-vs-real convergence (docs/plans/kpi-simulation-skill.md P3).
//
// The production channel is the truth line; simulated channels (env local/test,
// source 'simulation') are predictions about it. This model pairs each sim
// point with its nearest-in-time production point and expresses the gap in KPI
// units and as a share of the KPI's target span — so the detail modal can say
// "the simulation runs 13.9 pp above the last real reading" and, across
// successive sim runs, whether that gap is converging on reality.
//
// Honesty rules: no pairing is invented (no production data → no gap, an
// explicit empty state); a production reading older than the sim is flagged as
// STALE rather than treated as the current truth — the sim may simply be
// fresher, and the honest move is a re-measure, not a verdict.
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

export interface ConvergenceGap {
  simAt: number;
  simValue: number;
  simEnv: string;
  prodAt: number;
  prodValue: number;
  /** sim − prod, in KPI units (signed). */
  gap: number;
  /** |gap| as a share of the KPI's target span, null when the span is degenerate. */
  normalized: number | null;
  /** Days the production partner is OLDER than the sim point (0 when fresher/equal). */
  prodStaleDays: number;
}

export type ConvergenceVerdict = 'converging' | 'diverging' | 'stable' | 'insufficient';

export interface Convergence {
  /** One gap per sim point, chronological. */
  gaps: ConvergenceGap[];
  latest: ConvergenceGap | null;
  verdict: ConvergenceVerdict;
}

function ts(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime();
}

/** Split a KPI's measurement history into the truth channel and the sim channel. */
export function splitChannels(measurements: DevKpiMeasurement[]): {
  production: DevKpiMeasurement[];
  sim: DevKpiMeasurement[];
} {
  const production: DevKpiMeasurement[] = [];
  const sim: DevKpiMeasurement[] = [];
  for (const m of measurements) {
    if ((m.env ?? 'production') === 'production') production.push(m);
    else sim.push(m);
  }
  return { production, sim };
}

/** The KPI's value span used to normalize a gap. Target↔baseline when both
 *  exist and differ; else |target|; else the production value; null when all
 *  degenerate (a 0-target 0-baseline KPI has no meaningful relative gap). */
export function gapSpan(
  target: number | null | undefined,
  baseline: number | null | undefined,
  prodValue: number,
): number | null {
  if (target != null && baseline != null && target !== baseline) return Math.abs(target - baseline);
  if (target != null && target !== 0) return Math.abs(target);
  if (prodValue !== 0) return Math.abs(prodValue);
  return null;
}

const DAY_MS = 86_400_000;
/** Verdict threshold: the |normalized gap| must move by more than this between
 *  the first and last sim run to count as a direction. */
const VERDICT_EPS = 0.02;

export function computeConvergence(
  measurements: DevKpiMeasurement[],
  target: number | null | undefined,
  baseline: number | null | undefined,
): Convergence {
  const { production, sim } = splitChannels(measurements);
  const prodPts = production
    .map((m) => ({ t: ts(m.measured_at), v: m.value }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const simPts = sim
    .map((m) => ({ t: ts(m.measured_at), v: m.value, env: m.env }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  const firstProd = prodPts[0];
  if (firstProd === undefined || simPts.length === 0) {
    return { gaps: [], latest: null, verdict: 'insufficient' };
  }

  const gaps: ConvergenceGap[] = simPts.map((s) => {
    let partner = firstProd;
    for (const p of prodPts) {
      if (Math.abs(p.t - s.t) < Math.abs(partner.t - s.t)) partner = p;
    }
    const gap = s.v - partner.v;
    const span = gapSpan(target, baseline, partner.v);
    return {
      simAt: s.t,
      simValue: s.v,
      simEnv: s.env,
      prodAt: partner.t,
      prodValue: partner.v,
      gap,
      normalized: span != null ? Math.abs(gap) / span : null,
      prodStaleDays: Math.max(0, Math.round((s.t - partner.t) / DAY_MS)),
    };
  });

  const latest = gaps[gaps.length - 1] ?? null;

  // Direction needs at least two DISTINCT sim runs with a normalizable gap.
  const normed = gaps.filter((g) => g.normalized != null);
  let verdict: ConvergenceVerdict = 'insufficient';
  const first = normed[0]?.normalized;
  const last = normed[normed.length - 1]?.normalized;
  if (normed.length >= 2 && first != null && last != null) {
    verdict = last < first - VERDICT_EPS ? 'converging'
      : last > first + VERDICT_EPS ? 'diverging'
      : 'stable';
  }

  return { gaps, latest, verdict };
}
