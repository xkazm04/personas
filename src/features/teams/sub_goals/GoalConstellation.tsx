/**
 * Board + Map — the two consolidated goal surfaces, selected by the Goals L2
 * sub-nav (`variant`). Clicking a goal in either opens the shared
 * GoalDetailDrawer. The Map is a pan/zoom React Flow canvas (`GoalGraphMap`)
 * over parent/child + dependency edges; node colour comes from the canonical
 * `goalStatus` model.
 */
import { useState, useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import * as devApi from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import GoalKanban from './GoalKanban';
import { GoalGraphMap } from './GoalGraphMap';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';

type VariantId = 'board' | 'map';

export default function GoalConstellation({ variant = 'board' }: { variant?: VariantId } = {}) {
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  const [dependencies, setDependencies] = useState<DevGoalDependency[]>([]);
  // Goal opened in the detail drawer (from a Board card or a Map node), and the
  // goal being edited (the drawer's Edit hands off to GoalEditorModal).
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);

  // Consume any pending detail handoff (e.g. from a ContextMap goal-coverage
  // badge click). Read once on mount; clear so it can't refire.
  useEffect(() => {
    const pending = useSystemStore.getState().pendingGoalSpotlightId;
    if (pending) setDetailGoalId(pending);
    useSystemStore.getState().setPendingGoalSpotlightId(null);
  }, []);

  // (Goals are fetched at the GoalsPage level so an empty board still loads.)

  // Dependencies (Map edges) — only the Map needs them. One project-scoped query
  // (no per-goal fan-out); refetches when the project or goal count changes.
  useEffect(() => {
    if (variant !== 'map' || !activeProjectId || goals.length === 0) return;
    let cancelled = false;
    devApi.listGoalDependenciesForProject(activeProjectId)
      .then((deps) => { if (!cancelled) setDependencies(deps); })
      .catch(silentCatch('GoalConstellation.loadDeps'));
    return () => { cancelled = true; };
  }, [variant, activeProjectId, goals.length]);

  return (
    <div className="space-y-3">
      {variant === 'board' && <GoalKanban onOpenGoal={setDetailGoalId} />}
      {variant === 'map' && (
        <GoalGraphMap
          goals={goals}
          dependencies={dependencies}
          projectId={activeProjectId}
          onGoalClick={setDetailGoalId}
        />
      )}

      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        onClose={() => setDetailGoalId(null)}
        onEdit={(g) => { setDetailGoalId(null); setEditGoal(g); }}
      />
      {activeProjectId && (
        <GoalEditorModal
          isOpen={!!editGoal}
          editGoal={editGoal}
          projectId={activeProjectId}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}
