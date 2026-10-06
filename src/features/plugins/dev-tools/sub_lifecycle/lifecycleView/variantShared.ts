/**
 * Shared, pure helpers for the three RailBelow prototype variants
 * (`RailBelowVariant{1,2,3}.tsx`). Every variant keeps the baseline's
 * information architecture and data; these are the derivations they all read so
 * a variant differs only in how it DRAWS a step, never in what it says about it.
 *
 * Prototype scaffolding - deleted or folded into the winner at consolidation.
 */
import { useState } from 'react';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecycleStepTally } from '@/lib/bindings/LifecycleStepTally';

import type { JourneyNode } from '../journey/journeyModel';
import { LEGEND_STATES } from '../journey/journeyStyles';

/** Outcome order for every tally readout: the good one first, the bad one last. */
export const OUTCOMES: LifecycleOutcome[] = ['done', 'skipped', 'unknown', 'failed'];

/**
 * The stroke ladder of `journeyStyles` (style + width per state) as SVG stroke
 * parameters, so a drawn ring tells the five states apart without colour exactly
 * the way the baseline's CSS borders do: solid 2 / solid 1 / dashed 2 / dotted 2
 * / dashed 1. Dotted is a zero-length dash on a round cap.
 */
export const LADDER: Record<LifecycleBindingState, { width: number; dash?: string; cap?: 'round' }> = {
  live: { width: 2 },
  detected: { width: 1 },
  pending: { width: 2, dash: '4 3' },
  missing: { width: 2, dash: '0.01 4', cap: 'round' },
  advisory: { width: 1, dash: '3 3' },
};

/** How many steps sit in each binding state, in legend order. */
export function stateCounts(order: JourneyNode[]): Record<LifecycleBindingState, number> {
  const out = Object.fromEntries(LEGEND_STATES.map((s) => [s, 0])) as Record<LifecycleBindingState, number>;
  for (const n of order) out[n.strongestState] += 1;
  return out;
}

/** Every change in the window, observed or not. */
export function tallyTotal(t: LifecycleStepTally): number {
  return t.done + t.skipped + t.unknown + t.failed;
}

/** Done over OBSERVED outcomes; null when nothing was observed (never a confident zero). */
export function doneRatio(t: LifecycleStepTally): number | null {
  const observed = t.done + t.skipped + t.failed;
  return observed === 0 ? null : t.done / observed;
}

/**
 * Which way the selection last moved along the journey (+1 right, -1 left), so
 * the state region can slide its content in from the side the eye travelled
 * from. Derived-state-in-render (the React-documented pattern), no ref read.
 */
export function useStepDirection(order: JourneyNode[], selectedId: string | null): 1 | -1 {
  const index = order.findIndex((n) => n.id === selectedId);
  const [prev, setPrev] = useState<{ id: string | null; index: number; dir: 1 | -1 }>({ id: selectedId, index, dir: 1 });
  if (prev.id !== selectedId) {
    const dir: 1 | -1 = index >= prev.index ? 1 : -1;
    setPrev({ id: selectedId, index, dir });
    return dir;
  }
  return prev.dir;
}

/** A capped entrance delay in seconds: the tenth node waits no longer than the eighth. */
export function enterDelay(index: number, step = 0.035, base = 0): number {
  return base + Math.min(index, 8) * step;
}
