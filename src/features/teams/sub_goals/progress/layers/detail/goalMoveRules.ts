/**
 * The moves L2 offers on one goal, as pure data, so all three prototypes and a
 * test agree on them without a provider.
 *
 *   nextGoalStatuses  which status steps a goal may take from here, through the
 *                     plain `updateGoal` path the Kanban and the editor already
 *                     use. `awaiting_acceptance` has NONE here: its two exits are
 *                     the acceptance verdicts (accept / reject with a reason),
 *                     which own their own mutation and must not be bypassed by a
 *                     status write.
 *   moveTargets       where a goal can be re-bound to: every OTHER milestone of
 *                     the project that is not shipped, then "Unassigned" unless
 *                     it already is.
 */
import type { MilestoneLane } from '../../milestoneOps';
import { normalizeGoalStatus, type GoalStatus } from '../../../goalStatus';

const STEPS: Record<GoalStatus, readonly GoalStatus[]> = {
  open: ['in-progress'],
  'in-progress': ['done', 'blocked'],
  blocked: ['in-progress'],
  awaiting_acceptance: [],
  // Reopening is a real move (a goal marked done too early) and the same write.
  done: ['in-progress'],
};

export function nextGoalStatuses(raw: string): readonly GoalStatus[] {
  return STEPS[normalizeGoalStatus(raw)];
}

export interface MoveTarget {
  /** A milestone id, or `null` for "no milestone". */
  id: string | null;
  /** The milestone's name; `null` for the Unassigned row (the caller labels it). */
  name: string | null;
}

/**
 * `current` is the milestone the goal is being looked at in (`null` when the
 * operator is in the Unassigned view). A shipped milestone is a record, so it
 * is never offered as a destination.
 */
export function moveTargets(lanes: readonly MilestoneLane[], current: string | null): MoveTarget[] {
  const targets: MoveTarget[] = lanes
    .filter((l) => l.id !== current && l.status !== 'shipped')
    .map((l) => ({ id: l.id, name: l.name }));
  if (current !== null) targets.push({ id: null, name: null });
  return targets;
}
