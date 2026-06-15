/**
 * Board host — the goal kanban plus the shared detail drawer + editor modal.
 * Clicking a goal card opens GoalDetailDrawer; the drawer's Edit hands off to
 * GoalEditorModal. (The Map view was removed; this surface is Board-only now.)
 */
import { useState, useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import GoalKanban from './GoalKanban';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';

export default function GoalConstellation({
  showDoneLane = false,
  showProject = false,
}: { showDoneLane?: boolean; showProject?: boolean } = {}) {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  // Goal opened in the detail drawer (from a Board card), and the goal being
  // edited (the drawer's Edit hands off to GoalEditorModal).
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

  return (
    <div className="space-y-3">
      <GoalKanban onOpenGoal={setDetailGoalId} showDone={showDoneLane} showProject={showProject} />

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
