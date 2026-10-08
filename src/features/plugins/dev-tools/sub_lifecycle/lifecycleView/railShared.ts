/**
 * Pure helpers the Lifecycle rail and its presets share.
 */
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

/** Outcome order for every tally readout: the good one first, the bad one last. */
export const OUTCOMES: LifecycleOutcome[] = ['done', 'skipped', 'unknown', 'failed'];

/** A capped entrance delay in seconds: the tenth node waits no longer than the eighth. */
export function enterDelay(index: number, step = 0.035, base = 0): number {
  return base + Math.min(index, 8) * step;
}
