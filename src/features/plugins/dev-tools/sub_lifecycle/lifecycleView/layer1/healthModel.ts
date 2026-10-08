/**
 * Pure model behind the Layer-1 health views: the snapshot's `health` joined
 * to the journey's step nodes, every metric a step SHOULD carry (so a step
 * with no measurement still shows its N/A slots instead of an empty box), and
 * the verdict -> visual token table Layer 1 and Layer 2 draw from. No React,
 * no i18n, no IO.
 *
 * Two conventions this file owns, because the contract does not state them:
 *
 * 1. `value: null` is "we don't know". It is never coerced to 0, and a
 *    `ratio` is null with it, so nothing downstream can draw an empty bar
 *    that reads as a measured zero.
 * 2. RATE SCALE. `coverage_pct` and `docs_clean_pct` are 0-100 by name;
 *    `pass_rate` and `done_rate` are not named, and the brief reads them as
 *    percent too. `RATE_SCALE` is the one place that decides it.
 */
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';
import type { LifecycleStepHealthView } from '@/lib/bindings/LifecycleStepHealthView';

import type { JourneyNode } from '../../journey/journeyModel';

/** Every rate metric arrives on a 0..RATE_SCALE scale (100 = percent). */
export const RATE_SCALE = 100;

export const HEALTH_ORDER: LifecycleHealth[] = ['green', 'amber', 'red', 'stale', 'unmeasured', 'instructed'];

export interface StepMetric {
  key: LifecycleMetricKey;
  value: number | null;
  samples: number;
  /** 0..1 for a rate, for drawing; null for a duration or an unknown value. */
  ratio: number | null;
}

export interface HealthStep {
  node: JourneyNode;
  health: LifecycleHealth;
  /** The backend's one-line why; null when it gave none. */
  reason: string | null;
  /** The step's expected metrics, in display order, N/A-filled. */
  metrics: StepMetric[];
  /** The number the step is judged by (drawn large); null for an instructed step. */
  primary: StepMetric | null;
  measuredAt: string | null;
  /** For a `stale` step, the verdict it had on the older base tip; null otherwise or when unknown. */
  staleOf: LifecycleHealth | null;
}

/** The verdict a stale step's older measure gave; no row means "not known". */
export function readStaleOf(row: LifecycleStepHealthView | undefined): LifecycleHealth | null {
  return row?.staleOf ?? null;
}

/** Steps nothing can observe: the backend reports them `instructed`, and so does a missing row. */
const INSTRUCTED_STEPS: ReadonlySet<string> = new Set(['frame', 'recall']);
const EVIDENCE_STEPS: ReadonlySet<string> = new Set(['isolate', 'link', 'sync', 'commit', 'land', 'record']);

export function isInstructedStep(stepId: string): boolean {
  return INSTRUCTED_STEPS.has(stepId) || stepId.startsWith('x-');
}

/** The metric slots a step carries, primary first. */
export function expectedMetricKeys(stepId: string): LifecycleMetricKey[] {
  if (stepId === 'gate') return ['median_ms', 'pass_rate'];
  if (stepId === 'tests') return ['coverage_pct', 'median_ms', 'pass_rate'];
  if (stepId === 'docs') return ['docs_clean_pct'];
  if (EVIDENCE_STEPS.has(stepId)) return ['done_rate'];
  return [];
}

export function isRateKey(key: LifecycleMetricKey): boolean {
  return key !== 'median_ms';
}

export function metricRatio(key: LifecycleMetricKey, value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || !isRateKey(key)) return null;
  return Math.max(0, Math.min(1, value / RATE_SCALE));
}

function toMetric(key: LifecycleMetricKey, value: number | null, samples: number): StepMetric {
  return { key, value, samples, ratio: metricRatio(key, value) };
}

/**
 * The expected slots first (filled from the row, N/A when absent), then any
 * metric the backend sent that this table does not expect, so a new metric is
 * shown rather than silently dropped.
 */
export function stepMetrics(stepId: string, row: LifecycleStepHealthView | undefined): StepMetric[] {
  const sent = row?.metrics ?? [];
  const expected = expectedMetricKeys(stepId);
  const out = expected.map((key) => {
    const m = sent.find((s) => s.key === key);
    return toMetric(key, m?.value ?? null, m?.samples ?? 0);
  });
  for (const m of sent) if (!expected.includes(m.key)) out.push(toMetric(m.key, m.value, m.samples));
  return out;
}

/** Join `health` to the journey's nodes by step id. A step with no row is unmeasured (instructed for frame/recall/x-*). */
export function joinHealth(nodes: JourneyNode[], health: LifecycleStepHealthView[]): HealthStep[] {
  const byId = new Map(health.map((h) => [h.stepId, h]));
  return nodes.map((node) => {
    const row = byId.get(node.id);
    const verdict: LifecycleHealth = row?.health ?? (isInstructedStep(node.id) ? 'instructed' : 'unmeasured');
    const metrics = verdict === 'instructed' && !row?.metrics.length ? [] : stepMetrics(node.id, row);
    return {
      node,
      health: verdict,
      reason: row?.reason ?? null,
      metrics,
      primary: metrics[0] ?? null,
      measuredAt: row?.measuredAt ?? null,
      staleOf: verdict === 'stale' ? readStaleOf(row) : null,
    };
  });
}

export function healthCounts(steps: HealthStep[]): Record<LifecycleHealth, number> {
  const out = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0])) as Record<LifecycleHealth, number>;
  for (const s of steps) out[s.health] += 1;
  return out;
}

/** The goal as three countable claims: green, measurable-not-green, instructed. */
export function goalParts(goal: LifecycleGoalView): { green: number; notGreen: number; instructed: number } {
  const green = Math.max(0, Math.min(goal.measurableGreen, goal.measurableTotal));
  return { green, notGreen: Math.max(0, goal.measurableTotal - green), instructed: Math.max(0, goal.instructed) };
}

type KitTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface VerdictVisual {
  tone: KitTone;
  /** Ink for the verdict's glyph and label. */
  ink: string;
  /** The verdict's outline: a closed stroke is a measured verdict, dashed = unknown, dotted = stale. */
  outline: string;
  /** The fill behind a verdict surface. */
  wash: string;
  /** Hatched (stale): the measurement is from an older base tip. */
  hatched: boolean;
  /** A dashed ring: nothing was measured, so nothing is drawn as a quantity. */
  hollow: boolean;
  /** A card's edge band: the verdict as one solid, dashed, hairline or hatched stripe. */
  band: string;
}

/**
 * Six verdicts, separable without colour on two axes: stroke style (solid /
 * dashed / dotted / hairline) and the glyph each view draws beside the label.
 * `unmeasured` is a dashed outline with no fill, NOT a dim green; `instructed`
 * is a hairline on the quiet surface; `stale` is dotted and hatched.
 */
export const VERDICT: Record<LifecycleHealth, VerdictVisual> = {
  green: {
    tone: 'success', ink: 'text-status-success', outline: 'border-2 border-solid border-status-success/70',
    wash: 'bg-status-success/10', hatched: false, hollow: false, band: 'bg-status-success',
  },
  amber: {
    tone: 'warning', ink: 'text-status-warning', outline: 'border-2 border-solid border-status-warning/70',
    wash: 'bg-status-warning/10', hatched: false, hollow: false, band: 'bg-status-warning',
  },
  red: {
    tone: 'error', ink: 'text-status-error', outline: 'border-2 border-solid border-status-error/80',
    wash: 'bg-status-error/10', hatched: false, hollow: false, band: 'bg-status-error',
  },
  unmeasured: {
    tone: 'neutral', ink: 'text-foreground', outline: 'border-2 border-dashed border-foreground/45',
    wash: 'bg-transparent', hatched: false, hollow: true, band: 'border-l-4 border-dashed border-foreground/45',
  },
  instructed: {
    tone: 'neutral', ink: 'text-foreground', outline: 'border border-solid border-primary/15',
    wash: 'bg-secondary/30', hatched: false, hollow: false, band: 'bg-primary/15',
  },
  stale: {
    tone: 'info', ink: 'text-status-info', outline: 'border-2 border-dotted border-status-info/70',
    wash: 'lc1-hatch', hatched: true, hollow: false, band: 'border-l-4 border-dotted border-status-info',
  },
};
