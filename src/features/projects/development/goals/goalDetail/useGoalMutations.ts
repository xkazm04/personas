// Every act the goal-detail surface performs, and nothing it reads.
//
// Split from `useGoalDetail` 2026-10-05 to keep both files under the repo's
// 200-line ceiling. The division is real rather than arithmetic: this file is
// the write side, and every function in it ends the same way - do the thing,
// then `refresh()`, because the surface's reads are drawer-local and a mutation
// is the only thing that invalidates them.
import { useCallback, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import {
  resolveTeamAssignmentReview, setTeamAssignmentGoal, advanceTeamGoal, abortTeamAssignment,
} from '@/api/pipeline/assignments';
import { mapWithConcurrency } from '@/lib/concurrency';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { GoalProgressSuggestion } from '@/lib/bindings/GoalProgressSuggestion';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

/** Assignment statuses that mean "the team is actively on this goal". */
export function isActiveAssignment(status: string) {
  return status === 'queued' || status === 'running' || status === 'awaiting_review';
}

export function useGoalMutations({ goal, goalId, progress, assignments, refresh }: {
  goal: DevGoal | null;
  goalId: string | null;
  progress: GoalProgressSuggestion | null;
  assignments: TeamAssignment[];
  refresh: () => Promise<void>;
}) {
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const acceptGoal = useSystemStore((s) => s.acceptGoal);
  const rejectGoal = useSystemStore((s) => s.rejectGoal);
  const recordGoalSignal = useSystemStore((s) => s.recordGoalSignal);
  const projects = useSystemStore((s) => s.projects);

  const [newItem, setNewItem] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [aborting, setAborting] = useState(false);

  const acceptProgress = useCallback(async () => {
    if (!goal || !progress) return;
    try {
      await updateGoal(goal.id, { progress: progress.suggested });
      await refresh();
    } catch (err) {
      toastCatch('Failed to update progress')(err);
    }
  }, [goal, progress, updateGoal, refresh]);

  const advance = useCallback(async () => {
    if (!goalId) return;
    const teamId = projects.find((p) => p.id === goal?.project_id)?.team_id;
    if (!teamId) return;
    setAdvancing(true);
    try {
      // Builds a goal-linked assignment (from open to-dos, else decomposed) and
      // runs it. Returns null if a team is already advancing this goal.
      await advanceTeamGoal(teamId, goalId);
      await refresh();
    } catch (err) {
      toastCatch('Failed to advance goal')(err);
    } finally {
      setAdvancing(false);
    }
  }, [goalId, goal?.project_id, projects, refresh]);

  // Stop the team working this goal: abort every active assignment (gate-close -
  // the orchestrator stops launching new steps; an in-flight step finishes on
  // its own) and log the stop to the goal's activity. The goal itself is kept,
  // so it can be handed back later. NOTE: deleting a goal would NOT do this -
  // `team_assignments.goal_id` is a soft link with no FK, so a delete leaves the
  // team running orphaned; this is the safe "stop" path.
  const abort = useCallback(async () => {
    const active = assignments.filter((a) => isActiveAssignment(a.status));
    if (active.length === 0) return;
    setAborting(true);
    try {
      // Bounded, for the same reason as the step fan-out in `useGoalDetail`:
      // the width would otherwise be however many assignments happen to be
      // active. A rejection still propagates, which is what the catch below
      // wants - a partial stop is a failure worth reporting.
      await mapWithConcurrency(active, 4, (a) => abortTeamAssignment(a.id, 'Stopped from the goal modal'));
      if (goalId) {
        await recordGoalSignal(goalId, 'team_aborted', undefined, 'Team work stopped by the user.')
          .catch(silentCatch('GoalDetail.recordAbortSignal'));
      }
      await refresh();
    } catch (err) {
      toastCatch('Failed to stop the team')(err);
    } finally {
      setAborting(false);
    }
  }, [assignments, goalId, recordGoalSignal, refresh]);

  const addItem = useCallback(async () => {
    if (!goalId || !newItem.trim()) return;
    try {
      await devApi.createGoalItem(goalId, newItem.trim());
      setNewItem('');
      await refresh();
    } catch (err) {
      toastCatch('Failed to add item')(err);
    }
  }, [goalId, newItem, refresh]);

  const toggleItem = useCallback(async (item: DevGoalItem) => {
    try {
      await devApi.updateGoalItem(item.id, { done: !item.done });
      await refresh();
    } catch (err) {
      toastCatch('Failed to update item')(err);
    }
  }, [refresh]);

  const deleteItem = useCallback(async (id: string) => {
    try {
      await devApi.deleteGoalItem(id);
      await refresh();
    } catch (err) {
      toastCatch('Failed to delete item')(err);
    }
  }, [refresh]);

  const resolveStep = useCallback(async (stepId: string, action: 'skip' | 'abort') => {
    try {
      await resolveTeamAssignmentReview(stepId, { action });
      await refresh();
    } catch (err) {
      toastCatch('Failed to resolve step')(err);
    }
  }, [refresh]);

  const unlinkTeam = useCallback(async (assignmentId: string) => {
    try {
      await setTeamAssignmentGoal(assignmentId, null);
      await refresh();
    } catch (err) {
      toastCatch('Failed to unlink team')(err);
    }
  }, [refresh]);

  const addDep = useCallback(async (dependsOnId: string, type: string) => {
    if (!goalId || !dependsOnId) return;
    try {
      await devApi.addGoalDependency(goalId, dependsOnId, type);
      await refresh();
    } catch (err) {
      toastCatch('Failed to add dependency')(err);
    }
  }, [goalId, refresh]);

  const removeDep = useCallback(async (id: string) => {
    try {
      await devApi.removeGoalDependency(id);
      await refresh();
    } catch (err) {
      toastCatch('Failed to remove dependency')(err);
    }
  }, [refresh]);

  // accept/rejectGoal REJECT on a failed write (the store already toasted);
  // catch here so the verdict does not escape a click handler as an unhandled
  // rejection, and so `refresh()` is skipped - there is nothing to read back.
  const accept = useCallback(() => {
    if (!goal) return;
    void (async () => { await acceptGoal(goal.id); await refresh(); })()
      .catch(silentCatch('GoalDetail.acceptGoal'));
  }, [goal, acceptGoal, refresh]);

  const reject = useCallback((comment: string) => {
    if (!goal) return;
    void (async () => { await rejectGoal(goal.id, comment); await refresh(); })()
      .catch(silentCatch('GoalDetail.rejectGoal'));
  }, [goal, rejectGoal, refresh]);

  return {
    newItem, setNewItem, advancing, aborting,
    acceptProgress, advance, abort, addItem, toggleItem, deleteItem,
    resolveStep, unlinkTeam, addDep, removeDep, accept, reject,
  };
}
