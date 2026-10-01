/**
 * What the last answer changed, for stage mode to play (spark
 * twin-portable-blueprint). `instantDelta` is computed the moment an answer is
 * given from the step and its goal; `reconciledDelta` merges the reconcile
 * pass's coverage gain and reason when the snapshot that carries them arrives.
 *
 * CONTRACT STUB (WP0): the bodies land in WP6. Signatures frozen.
 */
import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';

import type { BlueprintDelta } from './blueprintContract';

/** The delta known at answer time: topic, kind, goal and channel of the answered step. */
export function instantDelta(step: SetupStep, goals: readonly SetupGoal[]): BlueprintDelta | null {
  void step;
  void goals;
  return null;
}

/** Merge the reconcile pass's gain and reason into an instant delta, from the refreshed transcript and goals. */
export function reconciledDelta(
  delta: BlueprintDelta,
  transcript: readonly SetupStep[],
  goals: readonly SetupGoal[],
): BlueprintDelta {
  void transcript;
  void goals;
  return delta;
}
