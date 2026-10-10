/**
 * A step against itself one measurement earlier (`previous` on the snapshot's
 * health row): how each metric moved, whether that was good, and the verdict
 * it had when that verdict was different. Pure: no React, no i18n, no IO.
 *
 * Three conventions this file owns:
 *
 * 1. NO EARLIER MEASURE IS NO MARK. A null `previous`, or a metric that is
 *    unknown on either side, yields `null`, never a change of 0: "+0" would
 *    claim a comparison that was never made.
 * 2. A change is judged at the precision its figure is shown at: whole points
 *    for a rate (the figure is drawn without decimals), whole seconds for a
 *    time. A move that rounds to nothing is `flat` - known, and unchanged.
 * 3. GOOD depends on the metric: a higher pass, coverage, docs-clean or done
 *    rate is good; a longer median time is bad.
 */
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';
import type { LifecyclePreviousView } from '@/lib/bindings/LifecyclePreviousView';

import { isRateKey, type HealthStep, type StepMetric } from './healthModel';

export type DeltaDirection = 'up' | 'down' | 'flat';
export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface MetricDelta {
  key: LifecycleMetricKey;
  previous: number;
  current: number;
  /** `current - previous` at the figure's precision: whole points, or whole seconds in ms. */
  change: number;
  direction: DeltaDirection;
  tone: DeltaTone;
}

export interface StepChange {
  /** The card figure's change; null when either side is unknown. */
  figure: MetricDelta | null;
  /** Every metric that is known on both sides, in the step's metric order. */
  metrics: MetricDelta[];
  /** The verdict before, only when it differs from the verdict now. */
  was: LifecycleHealth | null;
}

/** A higher value is better for every rate; a time is better shorter. */
export function higherIsBetter(key: LifecycleMetricKey): boolean {
  return isRateKey(key);
}

function atPrecision(key: LifecycleMetricKey, change: number): number {
  const r = isRateKey(key) ? Math.round(change) : Math.round(change / 1000) * 1000;
  return r === 0 ? 0 : r; // never -0
}

/** One metric's move, or null when either side is unknown. */
export function metricDelta(key: LifecycleMetricKey, current: number | null, previous: number | null): MetricDelta | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const change = atPrecision(key, current - previous);
  if (change === 0) return { key, previous, current, change, direction: 'flat', tone: 'neutral' };
  const up = change > 0;
  return { key, previous, current, change, direction: up ? 'up' : 'down', tone: up === higherIsBetter(key) ? 'good' : 'bad' };
}

function previousValue(previous: LifecyclePreviousView, key: LifecycleMetricKey): number | null {
  return previous.metrics.find((m) => m.key === key)?.value ?? null;
}

/**
 * The step's change since its earlier measure. Null when there is no earlier
 * measure at all. For a STALE step with no differing earlier verdict, `was` is
 * the verdict its older measure gave (`staleOf`), which is what "stale" hides.
 */
export function stepChange(step: Pick<HealthStep, 'health' | 'metrics' | 'figure' | 'previous' | 'staleOf'>): StepChange | null {
  const { previous } = step;
  const staleWas = step.health === 'stale' && step.staleOf && step.staleOf !== 'stale' ? step.staleOf : null;
  if (!previous) return staleWas ? { figure: null, metrics: [], was: staleWas } : null;
  const one = (m: StepMetric) => metricDelta(m.key, m.value, previousValue(previous, m.key));
  const metrics = step.metrics.map(one).filter((d): d is MetricDelta => d !== null);
  return {
    figure: step.figure ? one(step.figure) : null,
    metrics,
    was: previous.health !== step.health ? previous.health : staleWas,
  };
}
