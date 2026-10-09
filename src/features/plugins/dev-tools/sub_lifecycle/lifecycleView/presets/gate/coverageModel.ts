/**
 * The coverage chart's model, pure: the coverage runs that reported a value,
 * oldest first, the zone each reading falls in against the step's thresholds,
 * and the band of values the chart zooms to so a few points of movement show.
 */
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';

import { SPARK_RUNS } from '../gateModel';

export interface CoveragePoint {
  run: LifecycleRun;
  value: number;
}

/** Coverage-kind runs with a reading, oldest first, at most {@link SPARK_RUNS}. */
export function coveragePoints(runsNewestFirst: LifecycleRun[]): CoveragePoint[] {
  return runsNewestFirst
    .filter((r) => r.kind === 'coverage' && r.valuePct != null)
    .slice(0, SPARK_RUNS)
    .map((run) => ({ run, value: run.valuePct! }))
    .reverse();
}

/** A coverage zone is one of the three measured verdicts. */
export type CoverageZone = 'green' | 'amber' | 'red';

/** The verdict a coverage reading earns against the green line and the amber floor. */
export function coverageZone(value: number, green: number, amber: number): CoverageZone {
  return value >= green ? 'green' : value >= amber ? 'amber' : 'red';
}

/** The value band drawn: the readings and both thresholds, with 10 points of room, within 0..100. */
export function coverageDomain(values: number[], green: number, amber: number): { min: number; max: number } {
  const min = Math.max(0, Math.min(amber, ...values) - 10);
  const max = Math.min(100, Math.max(green, ...values) + 10);
  return { min, max: max > min ? max : min + 1 };
}

/** Points from the first drawn reading to the latest (null with fewer than two). */
export function coverageChange(points: CoveragePoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]!.value - points[0]!.value;
}
