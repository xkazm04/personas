/**
 * What the last answer changed, for stage mode to play (spark
 * twin-portable-blueprint). `instantDelta` is computed the moment an answer is
 * given from the step and its goal; `reconciledDelta` merges the reconcile
 * pass's coverage gain and reason when the snapshot that carries them arrives.
 *
 * Both are pure. `reconciledDelta` returns the SAME object when nothing new has
 * arrived, so a caller can compare by identity and an effect keyed on the
 * delta does not replay for a refetch that changed nothing.
 */
import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';

import { TRAINING_TOPIC_PRESETS } from '../sub_training/topicPresets';
import type { BlueprintDelta, StepKind, TopicId } from './blueprintContract';

const STEP_KINDS: readonly StepKind[] = ['scene', 'opinion', 'reply_drill', 'fact', 'rule', 'preference'];
const TOPIC_IDS: ReadonlySet<string> = new Set(TRAINING_TOPIC_PRESETS.map((p) => p.id));
const TRAINING_SLOT = 'training:';

/** Statuses that are not an answer: nothing for the blueprint to play. */
const NOT_ANSWERED: ReadonlySet<string> = new Set(['queued', 'skipped', 'obsolete']);

/** The engine writes `kind` as free text; an unknown value is no kind at all. */
export function stepKindOf(kind: string): StepKind | null {
  return (STEP_KINDS as readonly string[]).includes(kind) ? (kind as StepKind) : null;
}

/** The topic a goal slot names (`training:<topicId>`), when it names a known one. */
export function topicOfSlot(slot: string | null | undefined): TopicId | null {
  if (!slot || !slot.startsWith(TRAINING_SLOT)) return null;
  const id = slot.slice(TRAINING_SLOT.length);
  return TOPIC_IDS.has(id) ? (id as TopicId) : null;
}

/**
 * The delta known at answer time: topic, kind, goal and channel of the answered
 * step. `null` when the step is not an answer (queued, skipped, obsolete).
 */
export function instantDelta(step: SetupStep, goals: readonly SetupGoal[]): BlueprintDelta | null {
  if (NOT_ANSWERED.has(step.status)) return null;
  const goal = step.goalId ? goals.find((g) => g.id === step.goalId) : undefined;
  return {
    answeredStepId: step.id,
    phase: 'instant',
    topicId: topicOfSlot(goal?.slot),
    kind: stepKindOf(step.kind),
    goalId: step.goalId,
    coverageGain: null,
    why: null,
    channel: step.toneChannel,
  };
}

/**
 * Merge the reconcile pass's gain and reason into an instant delta, from the
 * refreshed transcript and goals. The late phase fires only once the answered
 * step carries a `coverageGain` (WP1 puts it on the wire); until then, and for
 * a delta that is already reconciled, the input comes back unchanged.
 */
export function reconciledDelta(
  delta: BlueprintDelta,
  transcript: readonly SetupStep[],
  goals: readonly SetupGoal[],
): BlueprintDelta {
  if (delta.phase === 'reconciled') return delta;
  const step = transcript.find((s) => s.id === delta.answeredStepId);
  if (!step || step.coverageGain === null) return delta;
  const goalId = delta.goalId ?? step.goalId;
  const goal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  return {
    ...delta,
    phase: 'reconciled',
    goalId,
    topicId: delta.topicId ?? topicOfSlot(goal?.slot),
    coverageGain: step.coverageGain,
    why: goal?.lastWhy ?? null,
  };
}
