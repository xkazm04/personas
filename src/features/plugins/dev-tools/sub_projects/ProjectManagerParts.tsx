/**
 * Sub-components extracted from ProjectManagerPage:
 *   - ProjectRowMenu — three-dot edit/delete menu for a project table row
 *   - GoalBoard      — goal list + inline creation + implementation log sidebar
 */
import { useState } from 'react';
import {
  Target, GripVertical, Trash2, Plus, MoreHorizontal, Pencil,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';
import { ImplementationLog } from './ImplementationLog';
import { type Goal, GOAL_ICONS, StatusBadge } from './projectManagerTypes';

// ---------------------------------------------------------------------------
// ProjectRowMenu
// ---------------------------------------------------------------------------

export function ProjectRowMenu({
  projectId,
  projectName,
  onEdit,
}: {
  projectId: string;
  projectName: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleteProject = useSystemStore((s) => s.deleteProject);

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onEdit();
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    await deleteProject(projectId);
    setOpen(false);
    setConfirming(false);
  };

  return (
    <div className="self-center relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); setConfirming(false); }}
        className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setConfirming(false); }} />
          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-modal border border-primary/15 bg-background shadow-elevation-3 overflow-hidden py-1">
            <button
              type="button"
              onClick={handleEdit}
              className="w-full flex items-center gap-2 px-3 py-2 typo-caption text-left text-foreground hover:bg-primary/5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t.plugins.dev_projects.edit_project}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className={`w-full flex items-center gap-2 px-3 py-2 typo-caption text-left transition-colors ${
                confirming ? 'bg-red-500/10 text-red-400' : 'text-red-400/70 hover:bg-red-500/5'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {confirming ? `Delete "${projectName.slice(0, 12)}"?` : 'Delete Project'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalBoard
// ---------------------------------------------------------------------------

export function GoalBoard({
  goals,
  onUpdateGoal: _onUpdateGoal,
  onDeleteGoal,
  onCreateGoal,
  selectedGoalId,
  onSelectGoal,
  onAddNote,
  rawGoalSignals,
}: {
  goals: Goal[];
  onUpdateGoal: (id: string, data: Partial<Goal>) => void;
  onDeleteGoal: (id: string) => void;
  onCreateGoal: (title: string) => void;
  selectedGoalId: string | null;
  onSelectGoal: (id: string | null) => void;
  onAddNote: (goalId: string, message: string) => void;
  rawGoalSignals: import('@/lib/bindings/DevGoalSignal').DevGoalSignal[];
}) {
  const { t } = useTranslation();
  const [newTitle, setNewTitle] = useState('');
  const { staggerDelay: _staggerDelay } = useMotion();

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreateGoal(newTitle.trim());
    setNewTitle('');
  };

  const selectedGoal = goals.find((g) => g.id === selectedGoalId);

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Goal list */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-amber-400" />
          <h3 className="typo-section-title">Goals</h3>
          <span className="typo-caption text-foreground">{goals.length}</span>
        </div>

        {goals.length === 0 ? (
          <div className="text-center py-12">
            <Target className="w-8 h-8 text-foreground mx-auto mb-2" />
            <p className="text-md text-foreground">{t.plugins.dev_projects.no_goals_add_below}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {goals.map((goal, _i) => {
              const GoalIcon = GOAL_ICONS[goal.status];
              return (
                <div
                  key={goal.id}
                  className={`animate-fade-slide-in group flex items-center gap-3 px-3 py-2.5 rounded-modal border cursor-pointer transition-colors ${
                    selectedGoalId === goal.id
                      ? 'bg-primary/10 border-primary/20'
                      : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
                  }`}
                  onClick={() => onSelectGoal(selectedGoalId === goal.id ? null : goal.id)}
                >
                  <GripVertical className="w-3.5 h-3.5 text-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                  {GoalIcon && <GoalIcon className="w-4 h-4 flex-shrink-0 text-foreground" />}
                  <span className="flex-1 min-w-0 text-md text-foreground truncate">{goal.title}</span>
                  <div className="w-20 h-1.5 bg-primary/10 rounded-full overflow-hidden flex-shrink-0">
                    <div
                      className="h-full bg-amber-400/60 rounded-full transition-all"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                  <StatusBadge status={goal.status} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onDeleteGoal(goal.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline goal creation */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-primary/5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={t.plugins.dev_projects.goal_title_placeholder}
            className="flex-1 px-3 py-2 text-md bg-secondary/30 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring"
          />
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            disabled={!newTitle.trim()}
            onClick={handleCreate}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Implementation log sidebar */}
      {selectedGoal && (
        <div
          className="animate-fade-slide-in w-72 flex-shrink-0 border-l border-primary/10 pl-4 overflow-y-auto"
        >
          <ImplementationLog
            goalId={selectedGoal.id}
            signals={rawGoalSignals.filter((s) => s.goal_id === selectedGoal.id)}
            onAddNote={(msg) => onAddNote(selectedGoal.id, msg)}
          />
        </div>
      )}
    </div>
  );
}
