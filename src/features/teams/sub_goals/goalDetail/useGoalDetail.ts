// What the goal-detail surface READS, plus the one thing it derives from it.
//
// Extracted from `GoalDetailDrawer` 2026-10-05. The component was 774 lines
// holding store bindings, six parallel reads, 14 state slots, 20 handlers and a
// seven-section render in one function - which is also why it could only ever
// have ONE layout. With the data behind this hook and a context, a layout is a
// file that arranges blocks, so three of them cost three small files instead of
// three copies of this. The write side is `useGoalMutations`; the verification
// gate owns its own state in `useGoalUat`.
//
// Read paths are drawer-local (ephemeral, refetched on open + after each
// mutation) rather than in the global store, since this is modal-scoped.
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { listTeamAssignmentsForGoal, listTeamAssignmentSteps } from '@/api/pipeline/assignments';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import type { GoalProgressSuggestion } from '@/lib/bindings/GoalProgressSuggestion';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

import { isComplete, isAwaitingAcceptance } from '../goalStatus';
import { useGoalUat, type GoalUat } from './useGoalUat';
import { isActiveAssignment, useGoalMutations } from './useGoalMutations';

/** Dependency kinds the drawer authors (free-text on the wire; cycle-checked
 *  backend-side for 'blocks'). 'blocks' = must finish first; 'follows' = sequence. */
export const DEP_BLOCKS = 'blocks';
export const DEP_FOLLOWS = 'follows';

export interface GoalDetailInput {
  isOpen: boolean;
  goalId: string | null;
  onEdit: (goal: DevGoal) => void;
  onClose: () => void;
  /** Fallback goal for goals NOT in the active-project store (e.g. the
   *  cross-project channel sidebar). Used when the store lookup misses. */
  goalFallback?: DevGoal | null;
}

export function useGoalDetail({ isOpen, goalId, onEdit, onClose, goalFallback = null }: GoalDetailInput) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const allGoals = useSystemStore((s) => s.goals);
  const storeGoal = useSystemStore((s) => s.goals.find((g) => g.id === goalId) ?? null);
  // Fall back to the passed object for cross-project goals not in the store.
  const goal = storeGoal ?? (goalFallback && goalFallback.id === goalId ? goalFallback : null);
  const projects = useSystemStore((s) => s.projects);
  const personas = useAgentStore((s) => s.personas);
  // persona id -> persona, for the unified task table's Owner cell.
  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<GoalProgressSuggestion | null>(null);
  const [items, setItems] = useState<DevGoalItem[]>([]);
  const [subgoals, setSubgoals] = useState<DevGoal[]>([]);
  const [steps, setSteps] = useState<TeamAssignmentStep[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [signals, setSignals] = useState<DevGoalSignal[]>([]);
  const [deps, setDeps] = useState<DevGoalDependency[]>([]);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    try {
      const [prog, its, kids, asgns, sigs, dps] = await Promise.all([
        devApi.resolveGoalProgress(goalId).catch((err) => { silentCatch('GoalDetail:resolveGoalProgress')(err); return null; }),
        devApi.listGoalItems(goalId),
        devApi.listChildGoals(goalId),
        listTeamAssignmentsForGoal(goalId).catch((err) => { silentCatch('GoalDetail:listTeamAssignmentsForGoal')(err); return []; }),
        devApi.listGoalSignals(goalId),
        devApi.listGoalDependencies(goalId).catch((err) => { silentCatch('GoalDetail:listGoalDependencies')(err); return []; }),
      ]);
      setProgress(prog);
      setItems(its);
      setSubgoals(kids);
      setSignals(sigs);
      setDeps(dps);
      setAssignments(asgns);
      // Bounded at 4. A goal can carry an unbounded number of assignments, and
      // a bare `Promise.all(asgns.map(...))` would make the width of the fan-out
      // whatever the data happened to be - nobody chooses it, and nobody notices
      // until a goal with thirty assignments opens thirty IPC calls at once
      // (`widthless-collection-fanout`). Each item still catches its own
      // failure, so one missing step list does not lose the rest.
      const stepLists = await mapWithConcurrency(asgns, 4, (a) =>
        listTeamAssignmentSteps(a.id).catch((err) => { silentCatch('GoalDetail:listTeamAssignmentSteps')(err); return [] as TeamAssignmentStep[]; }));
      setSteps(stepLists.flat());
    } catch (err) {
      silentCatch('GoalDetail:refresh')(err);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  const mutations = useGoalMutations({ goal, goalId, progress, assignments, refresh });
  const { setNewItem } = mutations;

  useEffect(() => {
    if (isOpen && goalId) {
      setNewItem('');
      void refresh();
    }
  }, [isOpen, goalId, refresh, setNewItem]);

  const uat: GoalUat = useGoalUat({ goalId, isOpen, refresh, confirmMarkPassed: dl.uat_mark_passed_confirm });

  // Outgoing deps split by kind; resolve linked goal titles from the store.
  const goalById = useMemo(() => new Map(allGoals.map((g) => [g.id, g])), [allGoals]);
  const blocksDeps = deps.filter((d) => d.dependency_type !== DEP_FOLLOWS);
  const followsDeps = deps.filter((d) => d.dependency_type === DEP_FOLLOWS);
  // Candidate goals to link: same project, not self, not already linked. The
  // store can hold every project's goals (cross-project board scope), so this
  // must be scoped explicitly or the picker offers unrelated-project goals.
  const linkedIds = new Set(deps.map((d) => d.depends_on_id));
  const candidates = allGoals.filter(
    (g) => g.id !== goalId && !linkedIds.has(g.id) && g.project_id === goal?.project_id,
  );

  // Goal-UAT browser gate: web projects only (react/nodejs/combined). The
  // verify item is rendered in its own block, NOT as a regular to-do row.
  const project = projects.find((p) => p.id === goal?.project_id);
  const isWebProject = ['react', 'nodejs', 'combined'].includes(
    (project?.tech_stack ?? '').trim().toLowerCase(),
  );
  const verifyItem = items.find((i) => i.verify_kind === 'browser_test') ?? null;
  const todoItems = items.filter((i) => i.verify_kind == null);
  const todosComplete = todoItems.every((i) => i.done);
  // Hand-off state: a team is already working this goal when any linked
  // assignment is queued/running/awaiting-review. `hasTeam` gates the control -
  // there is no AI team to hand to unless the project has one.
  const hasActiveAssignment = assignments.some((a) => isActiveAssignment(a.status));
  const hasTeam = !!project?.team_id;

  const showNudge = !!goal && !!progress && progress.total_count > 0 && progress.suggested !== goal.progress;
  const awaitingAcceptance = !!goal && isAwaitingAcceptance(goal.status);
  const canHandOff = !!goal && !isComplete(goal.status) && !awaitingAcceptance && hasTeam;

  return {
    t, dl, goal, onEdit, onClose, refresh,
    loading, progress, items, subgoals, steps, assignments, signals, deps, personaById,
    uat, ...mutations,
    goalById, blocksDeps, followsDeps, candidates,
    isWebProject, verifyItem, todoItems, todosComplete,
    hasActiveAssignment, hasTeam, showNudge, awaitingAcceptance, canHandOff,
  };
}

export type GoalDetailModel = ReturnType<typeof useGoalDetail>;
