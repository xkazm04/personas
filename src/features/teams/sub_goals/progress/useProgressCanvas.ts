/**
 * The CANVAS layer of the Progress view: the milestone lanes each project row
 * carries, and the three mutations a row can perform on them.
 *
 * Separate from `useProgressModel` because the goals and the milestones are
 * independent reads with independent failure modes - a milestone read that
 * fails must not blank the goals, which is the whole surface. So the lanes
 * arrive as their OWN region with their own placeholder, retired by their own
 * data (overview-loading law: a region's placeholder is retired by that
 * region's data, and a fetch never hides already-rendered rows).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { projectWallSummary } from '@/api/devTools/milestones';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import {
  addMilestone,
  lanesFor,
  moveGoalToMilestone,
  removeMilestone,
  type MilestoneLane,
} from './milestoneOps';

/** How many projects' member-lists are shaped at once. */
const PROJECT_FANOUT = 4;

export interface ProgressCanvas {
  /** Lanes per project id. `null` while the first read is in flight. */
  lanesByProject: ReadonlyMap<string, MilestoneLane[]> | null;
  /** Which milestones a goal is bound to, by goal id. Empty = unassigned. */
  lanesOfGoal: (goalId: string) => string[];
  /** True while a mutation is in flight - the canvas stays interactive. */
  busy: boolean;
  createMilestone: (projectId: string, name: string) => void;
  deleteMilestone: (milestoneId: string) => void;
  /** `to === null` unbinds the goal from every milestone it is in. */
  bindGoal: (goalId: string, to: string | null) => void;
  reload: () => void;
}

/**
 * ONE batched read for the whole wall of rows, then one member-list read per
 * milestone at a declared width. `project_wall_summary` already returns full
 * milestone rows for N projects in a single IPC round trip, which is why this
 * does not fan `list_milestones` out per project.
 */
export function useProgressCanvas(projectIds: readonly string[]): ProgressCanvas {
  const [lanesByProject, setLanes] = useState<ReadonlyMap<string, MilestoneLane[]> | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable dependency: the ids themselves, not the array identity the caller
  // happened to build this render.
  const key = useMemo(() => [...projectIds].sort().join(','), [projectIds]);

  const load = useCallback(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setLanes(new Map());
      return;
    }
    void projectWallSummary(ids)
      .then((summaries) =>
        mapWithConcurrency(summaries, PROJECT_FANOUT, async (s) => {
          const lanes = await lanesFor(s.projectId, s.milestones);
          return [s.projectId, lanes] as const;
        }),
      )
      .then((pairs) => setLanes(new Map(pairs)))
      // A lane read that fails leaves `lanesByProject` as it was: the goals
      // are the surface and they are already drawn. Reported, never a toast -
      // nobody asked for the milestones, they came with the page.
      .catch(silentCatch('GoalsProgress.canvasLanes'));
  }, [key]);

  useEffect(load, [load]);

  const lanesOfGoal = useCallback(
    (goalId: string) => {
      const hits: string[] = [];
      for (const lanes of lanesByProject?.values() ?? []) {
        for (const lane of lanes) if (lane.goalIds.has(goalId)) hits.push(lane.id);
      }
      return hits;
    },
    [lanesByProject],
  );

  /**
   * Every mutation re-reads rather than patching local state. The write path is
   * three different backend doors (create / delete / member upsert) whose
   * results interact - a goal removed from a shipped cut changes that cut's
   * derived progress - so a local patch would be a second, divergent model of
   * what the backend just did.
   */
  const run = useCallback(
    (context: string, op: () => Promise<unknown>) => {
      setBusy(true);
      void op()
        .then(load)
        .catch(toastCatch(context))
        .finally(() => setBusy(false));
    },
    [load],
  );

  return {
    lanesByProject,
    lanesOfGoal,
    busy,
    createMilestone: useCallback(
      (projectId: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        run('GoalsProgress.createMilestone', () => addMilestone(projectId, trimmed));
      },
      [run],
    ),
    deleteMilestone: useCallback(
      (milestoneId: string) => {
        run('GoalsProgress.deleteMilestone', () => removeMilestone(milestoneId));
      },
      [run],
    ),
    bindGoal: useCallback(
      (goalId: string, to: string | null) => {
        const from = lanesOfGoal(goalId);
        if (from.length === 0 && to === null) return;
        if (from.length === 1 && from[0] === to) return;
        run('GoalsProgress.bindGoal', () => moveGoalToMilestone(goalId, from, to));
      },
      [run, lanesOfGoal],
    ),
    reload: load,
  };
}
