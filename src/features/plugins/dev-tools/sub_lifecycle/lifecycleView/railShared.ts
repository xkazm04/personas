/**
 * Pure helpers the Lifecycle rail, legend and state panel share.
 */
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import type { JourneyNode } from '../journey/journeyModel';
import { LEGEND_STATES } from '../journey/journeyStyles';

/** Outcome order for every tally readout: the good one first, the bad one last. */
export const OUTCOMES: LifecycleOutcome[] = ['done', 'skipped', 'unknown', 'failed'];

/** How many steps sit in each binding state, in legend order. */
export function stateCounts(order: JourneyNode[]): Record<LifecycleBindingState, number> {
  const out = Object.fromEntries(LEGEND_STATES.map((s) => [s, 0])) as Record<LifecycleBindingState, number>;
  for (const n of order) out[n.strongestState] += 1;
  return out;
}

/** A capped entrance delay in seconds: the tenth node waits no longer than the eighth. */
export function enterDelay(index: number, step = 0.035, base = 0): number {
  return base + Math.min(index, 8) * step;
}
