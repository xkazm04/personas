/**
 * GoalDetailDrawer — the focused detail surface for a single goal.
 *
 * Replaces the old Pulse "spotlight" inline pane. Composes the goal's:
 *  - hybrid progress nudge (resolve_goal_progress → accept/edit; never silent)
 *  - unified checklist: ad-hoc items (editable) ∪ sub-goals ∪ linked
 *    team-assignment steps (with inline intervention on awaiting_review)
 *  - live activity feed (dev_goal_signals — incl. the team_* signals the
 *    orchestrator writes)
 *
 * Read paths are drawer-local (ephemeral, refetched on open + after each
 * mutation) rather than in the global store, since this is modal-scoped.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Target, X, Plus, Trash2, Check, Circle, CheckCircle2, AlertCircle,
  Clock, Users, ListChecks, Activity, Loader2, Pencil, SkipForward, Ban,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import {
  listTeamAssignmentsForGoal, listTeamAssignmentSteps, resolveTeamAssignmentReview,
} from '@/api/pipeline/assignments';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';
import type { GoalProgressSuggestion } from '@/lib/bindings/GoalProgressSuggestion';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  goalId: string | null;
  /** Opens the GoalEditorModal in edit mode for this goal. */
  onEdit: (goal: DevGoal) => void;
}

const STATUS_TINT: Record<string, string> = {
  open: 'text-blue-400 border-blue-500/25 bg-blue-500/10',
  'in-progress': 'text-amber-400 border-amber-500/25 bg-amber-500/10',
  in_progress: 'text-amber-400 border-amber-500/25 bg-amber-500/10',
  blocked: 'text-red-400 border-red-500/25 bg-red-500/10',
  done: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
  completed: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
};

function stepIsDone(status: string) {
  return status === 'done' || status === 'skipped';
}

export function GoalDetailDrawer({ isOpen, onClose, goalId, onEdit }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const goal = useSystemStore((s) => s.goals.find((g) => g.id === goalId) ?? null);
  const updateGoal = useSystemStore((s) => s.updateGoal);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<GoalProgressSuggestion | null>(null);
  const [items, setItems] = useState<DevGoalItem[]>([]);
  const [subgoals, setSubgoals] = useState<DevGoal[]>([]);
  const [steps, setSteps] = useState<TeamAssignmentStep[]>([]);
  const [signals, setSignals] = useState<DevGoalSignal[]>([]);
  const [newItem, setNewItem] = useState('');

  const refresh = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    try {
      const [prog, its, kids, assignments, sigs] = await Promise.all([
        devApi.resolveGoalProgress(goalId).catch(() => null),
        devApi.listGoalItems(goalId),
        devApi.listChildGoals(goalId),
        listTeamAssignmentsForGoal(goalId).catch(() => []),
        devApi.listGoalSignals(goalId),
      ]);
      setProgress(prog);
      setItems(its);
      setSubgoals(kids);
      setSignals(sigs);
      const stepLists = await Promise.all(
        assignments.map((a) => listTeamAssignmentSteps(a.id).catch(() => [] as TeamAssignmentStep[])),
      );
      setSteps(stepLists.flat());
    } catch (err) {
      silentCatch('GoalDetailDrawer.refresh')(err);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    if (isOpen && goalId) {
      setNewItem('');
      refresh();
    }
  }, [isOpen, goalId, refresh]);

  const handleAcceptProgress = async () => {
    if (!goal || !progress) return;
    try {
      await updateGoal(goal.id, { progress: progress.suggested });
      await refresh();
    } catch (err) {
      toastCatch('Failed to update progress')(err);
    }
  };

  const handleAddItem = async () => {
    if (!goalId || !newItem.trim()) return;
    try {
      await devApi.createGoalItem(goalId, newItem.trim());
      setNewItem('');
      await refresh();
    } catch (err) {
      toastCatch('Failed to add item')(err);
    }
  };

  const handleToggleItem = async (item: DevGoalItem) => {
    try {
      await devApi.updateGoalItem(item.id, { done: !item.done });
      await refresh();
    } catch (err) {
      toastCatch('Failed to update item')(err);
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await devApi.deleteGoalItem(id);
      await refresh();
    } catch (err) {
      toastCatch('Failed to delete item')(err);
    }
  };

  const handleResolveStep = async (stepId: string, action: 'skip' | 'abort') => {
    try {
      await resolveTeamAssignmentReview(stepId, { action });
      await refresh();
    } catch (err) {
      toastCatch('Failed to resolve step')(err);
    }
  };

  if (!goal) return null;
  const showNudge = progress && progress.total_count > 0 && progress.suggested !== goal.progress;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="goal-detail-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4 max-h-[88vh] overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-interactive bg-violet-500/10 border border-violet-500/25 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h2 id="goal-detail-title" className="typo-section-title text-foreground">{goal.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${STATUS_TINT[goal.status] ?? STATUS_TINT.open}`}>
                {tokenLabel(t, 'goal_state', goal.status)}
              </span>
              <span className="typo-caption text-foreground tabular-nums">{goal.progress}%</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="ghost" size="sm" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => onEdit(goal)}>
            {t.common.edit}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>

      {goal.description && (
        <p className="typo-body text-foreground leading-relaxed mb-4">{goal.description}</p>
      )}

      {/* Hybrid progress nudge */}
      {showNudge && progress && (
        <div className="mb-4 rounded-card border border-violet-500/25 bg-violet-500/5 px-4 py-3 flex items-center gap-3">
          <Activity className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="typo-body text-foreground">
              {dl.goal_progress_suggested_label} <span className="font-semibold text-violet-400 tabular-nums">{progress.suggested}%</span>
              <span className="text-foreground"> ({goal.progress}% → {progress.suggested}%)</span>
            </p>
            <p className="typo-caption text-foreground">{progress.reason}</p>
          </div>
          <Button variant="accent" accentColor="violet" size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={handleAcceptProgress}>
            {dl.goal_progress_accept}
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 typo-caption text-foreground mb-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t.common.loading}
        </div>
      )}

      {/* Checklist — ad-hoc items */}
      <Section icon={ListChecks} label={dl.goal_detail_checklist}>
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleToggleItem(item)}
                className="shrink-0"
                aria-label={item.done ? dl.goal_item_mark_undone : dl.goal_item_mark_done}
              >
                {item.done
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : <Circle className="w-4 h-4 text-foreground" />}
              </button>
              <span className={`flex-1 typo-body ${item.done ? 'text-foreground line-through opacity-60' : 'text-foreground'}`}>
                {item.title}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteItem(item.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-red-400"
                aria-label={t.common.delete}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 mt-2">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); }}
            placeholder={dl.goal_item_add_placeholder}
            className="flex-1 px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
          <Button variant="ghost" size="icon-sm" disabled={!newItem.trim()} onClick={handleAddItem} aria-label={dl.goal_item_add}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </Section>

      {/* Sub-goals */}
      {subgoals.length > 0 && (
        <Section icon={Target} label={dl.goal_detail_subgoals}>
          <ul className="space-y-1.5">
            {subgoals.map((sg) => (
              <li key={sg.id} className="flex items-center gap-2.5 typo-body">
                {STATUS_TINT[sg.status]?.includes('emerald') || sg.progress >= 100
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <Circle className="w-4 h-4 text-foreground shrink-0" />}
                <span className="flex-1 text-foreground truncate">{sg.title}</span>
                <span className="typo-caption text-foreground tabular-nums">{sg.progress}%</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Linked team-assignment steps + intervention */}
      {steps.length > 0 && (
        <Section icon={Users} label={dl.goal_detail_team_steps}>
          <ul className="space-y-1.5">
            {steps.map((step) => {
              const awaiting = step.status === 'awaiting_review';
              return (
                <li key={step.id} className="flex items-center gap-2.5 typo-body">
                  {stepIsDone(step.status)
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : awaiting
                      ? <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      : <Clock className="w-4 h-4 text-foreground shrink-0" />}
                  <span className="flex-1 text-foreground truncate">{step.title}</span>
                  {awaiting ? (
                    <span className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon-sm" title={dl.goal_intervene_skip} onClick={() => handleResolveStep(step.id, 'skip')}>
                        <SkipForward className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title={dl.goal_intervene_abort} onClick={() => handleResolveStep(step.id, 'abort')}>
                        <Ban className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </span>
                  ) : (
                    <span className="typo-caption uppercase tracking-wide text-foreground shrink-0">
                      {tokenLabel(t, 'execution', step.status)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Activity feed */}
      {signals.length > 0 && (
        <Section icon={Activity} label={dl.goal_detail_activity}>
          <ul className="space-y-1.5">
            {signals.slice(0, 12).map((sig) => (
              <li key={sig.id} className="flex items-center gap-2 typo-caption text-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 shrink-0" />
                <span className="text-foreground">{sig.message ?? sig.signal_type}</span>
                <RelativeTime timestamp={sig.created_at} className="ml-auto text-foreground shrink-0" />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </BaseModal>
  );
}

function Section({ icon: Icon, label, children }: { icon: typeof Target; label: string; children: ReactNode }) {
  return (
    <div className="pt-3 mt-3 border-t border-primary/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-foreground" />
        <h3 className="typo-caption uppercase tracking-[0.18em] text-foreground">{label}</h3>
      </div>
      {children}
    </div>
  );
}
