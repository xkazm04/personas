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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Target, X, Plus, Trash2, Check, Circle, CheckCircle2,
  Users, ListChecks, Activity, Pencil, GitMerge, ArrowRight,
  Globe, Play, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { BaseModal } from '@/lib/ui/BaseModal';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import * as devApi from '@/api/devTools/devTools';
import {
  listTeamAssignmentsForGoal, listTeamAssignmentSteps, resolveTeamAssignmentReview,
  setTeamAssignmentGoal, advanceTeamGoal, abortTeamAssignment,
} from '@/api/pipeline/assignments';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';
import type { DevGoalDependency } from '@/lib/bindings/DevGoalDependency';
import type { GoalProgressSuggestion } from '@/lib/bindings/GoalProgressSuggestion';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';
import { GoalStatusBadge } from './GoalStatusBadge';
import { GoalHandoffPanel } from './GoalHandoffPanel';
import { GoalKpiLink } from './GoalKpiLink';
import { GoalTaskTable } from './GoalTaskTable';
import { isComplete } from './goalStatus';

/** Dependency kinds the drawer authors (free-text on the wire; cycle-checked
 *  backend-side for 'blocks'). 'blocks' = must finish first; 'follows' = sequence. */
const DEP_BLOCKS = 'blocks';
const DEP_FOLLOWS = 'follows';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  goalId: string | null;
  /** Opens the GoalEditorModal in edit mode for this goal. */
  onEdit: (goal: DevGoal) => void;
  /** Fallback goal object for goals NOT in the active-project store (e.g. the
   *  cross-project channel sidebar). Used when the store lookup misses. */
  goalFallback?: DevGoal | null;
}

/** Neutral chip for team-side statuses (queued/running/awaiting_review/…). */
const TEAM_CHIP = 'text-foreground border-primary/15 bg-primary/5';

/** Assignment statuses that mean "the team is actively on this goal". */
function isActiveAssignment(status: string) {
  return status === 'queued' || status === 'running' || status === 'awaiting_review';
}

export function GoalDetailDrawer({ isOpen, onClose, goalId, onEdit, goalFallback = null }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const allGoals = useSystemStore((s) => s.goals);
  const storeGoal = useSystemStore((s) => s.goals.find((g) => g.id === goalId) ?? null);
  // Fall back to the passed object for cross-project goals not in the store.
  const goal = storeGoal ?? (goalFallback && goalFallback.id === goalId ? goalFallback : null);
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const recordGoalSignal = useSystemStore((s) => s.recordGoalSignal);
  const projects = useSystemStore((s) => s.projects);
  const personas = useAgentStore((s) => s.personas);
  // persona id → persona, for the unified task table's Owner cell.
  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<GoalProgressSuggestion | null>(null);
  const [items, setItems] = useState<DevGoalItem[]>([]);
  const [subgoals, setSubgoals] = useState<DevGoal[]>([]);
  const [steps, setSteps] = useState<TeamAssignmentStep[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [signals, setSignals] = useState<DevGoalSignal[]>([]);
  const [deps, setDeps] = useState<DevGoalDependency[]>([]);
  const [newItem, setNewItem] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [uatScenario, setUatScenario] = useState('');
  const [uatUrl, setUatUrl] = useState('');
  const [uatRunning, setUatRunning] = useState(false);
  const [showUatForm, setShowUatForm] = useState(false);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    try {
      const [prog, its, kids, assignments, sigs, dps] = await Promise.all([
        devApi.resolveGoalProgress(goalId).catch(() => null),
        devApi.listGoalItems(goalId),
        devApi.listChildGoals(goalId),
        listTeamAssignmentsForGoal(goalId).catch(() => []),
        devApi.listGoalSignals(goalId),
        devApi.listGoalDependencies(goalId).catch(() => []),
      ]);
      setProgress(prog);
      setItems(its);
      setSubgoals(kids);
      setSignals(sigs);
      setDeps(dps);
      setAssignments(assignments);
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

  const handleAdvance = async () => {
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
  };

  // Stop the team working this goal: abort every active assignment (gate-close —
  // the orchestrator stops launching new steps; an in-flight step finishes on
  // its own) and log the stop to the goal's activity. The goal itself is kept,
  // so it can be handed back to the team later. NOTE: deleting a goal would NOT
  // do this — `team_assignments.goal_id` is a soft link with no FK, so a delete
  // leaves the team running orphaned; this is the safe "stop" path.
  const handleAbort = async () => {
    const active = assignments.filter((a) => isActiveAssignment(a.status));
    if (active.length === 0) return;
    setAborting(true);
    try {
      await Promise.all(active.map((a) => abortTeamAssignment(a.id, 'Stopped from the goal modal')));
      if (goalId) {
        await recordGoalSignal(goalId, 'team_aborted', undefined, 'Team work stopped by the user.')
          .catch(silentCatch('GoalDetailDrawer.recordAbortSignal'));
      }
      await refresh();
    } catch (err) {
      toastCatch('Failed to stop the team')(err);
    } finally {
      setAborting(false);
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

  const handleSaveUat = async () => {
    if (!goalId || !uatScenario.trim()) return;
    try {
      await devApi.setGoalVerification(goalId, uatScenario.trim(), uatUrl.trim() || undefined);
      setShowUatForm(false);
      setUatScenario('');
      setUatUrl('');
      await refresh();
    } catch (err) {
      toastCatch('Failed to add UAT gate')(err);
    }
  };

  const handleClearUat = async () => {
    if (!goalId) return;
    try {
      await devApi.clearGoalVerification(goalId);
      await refresh();
    } catch (err) {
      toastCatch('Failed to remove UAT gate')(err);
    }
  };

  const handleRunUat = async () => {
    if (!goalId) return;
    setUatRunning(true);
    try {
      // Spawns the browser-test turn (panel-side); the report card closes the
      // gate on a clean pass. Refresh shortly after so the "verifying" state
      // and any same-turn completion reflect.
      await devApi.runGoalUat(goalId);
      setTimeout(() => void refresh(), 4000);
    } catch (err) {
      toastCatch('Failed to start UAT')(err);
    } finally {
      setUatRunning(false);
    }
  };

  const handleMarkUatPassed = async () => {
    if (!goalId) return;
    if (!window.confirm(dl.uat_mark_passed_confirm)) return;
    try {
      // Override path: closes the gate without a test run — for when UAT was
      // verified out-of-band, or the report omitted goal_id so auto-close
      // didn't fire. The gate re-opens if new work is added later.
      await devApi.completeGoalUat(goalId);
      await refresh();
    } catch (err) {
      toastCatch('Failed to mark UAT passed')(err);
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

  const handleUnlinkTeam = async (assignmentId: string) => {
    try {
      await setTeamAssignmentGoal(assignmentId, null);
      await refresh();
    } catch (err) {
      toastCatch('Failed to unlink team')(err);
    }
  };

  const addDep = async (dependsOnId: string, type: string) => {
    if (!goalId || !dependsOnId) return;
    try {
      await devApi.addGoalDependency(goalId, dependsOnId, type);
      await refresh();
    } catch (err) {
      toastCatch('Failed to add dependency')(err);
    }
  };
  const removeDep = async (id: string) => {
    try {
      await devApi.removeGoalDependency(id);
      await refresh();
    } catch (err) {
      toastCatch('Failed to remove dependency')(err);
    }
  };

  // Outgoing deps split by kind; resolve linked goal titles from the store.
  const goalById = useMemo(() => new Map(allGoals.map((g) => [g.id, g])), [allGoals]);
  const blocksDeps = deps.filter((d) => d.dependency_type !== DEP_FOLLOWS);
  const followsDeps = deps.filter((d) => d.dependency_type === DEP_FOLLOWS);
  // Candidate goals to link: same project, not self, not already linked.
  const linkedIds = new Set(deps.map((d) => d.depends_on_id));
  const candidates = allGoals.filter((g) => g.id !== goalId && !linkedIds.has(g.id));

  if (!goal) return null;
  const showNudge = progress && progress.total_count > 0 && progress.suggested !== goal.progress;
  // Goal-UAT browser gate: web projects only (react/nodejs/combined). The
  // verify item is rendered in its own section, NOT as a regular to-do row.
  const project = projects.find((p) => p.id === goal.project_id);
  const isWebProject = ['react', 'nodejs', 'combined'].includes(
    (project?.tech_stack ?? '').trim().toLowerCase(),
  );
  const verifyItem = items.find((i) => i.verify_kind === 'browser_test') ?? null;
  const todoItems = items.filter((i) => i.verify_kind == null);
  const todosComplete = todoItems.every((i) => i.done);
  // Hand-off state: a team is already working this goal when any linked
  // assignment is queued/running/awaiting-review. hasTeam gates the control —
  // there's no AI team to hand to unless the project has one.
  const hasActiveAssignment = assignments.some((a) => isActiveAssignment(a.status));
  const hasTeam = !!projects.find((p) => p.id === goal.project_id)?.team_id;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="goal-detail-title"
      maxWidthClass="max-w-[50rem]"
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
              <GoalStatusBadge status={goal.status} />
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
        <div className="mb-4 rounded-card border border-primary/10 bg-card/30 px-3.5 py-3">
          <MarkdownRenderer content={goal.description} className="typo-body leading-relaxed" />
        </div>
      )}

      {/* KPI cross-reference — when this goal serves/derives from a KPI, lead
          with the outcome it's steering (read-only projection; stays silent if
          the KPI was archived). */}
      {goal.kpi_id && <GoalKpiLink kpiId={goal.kpi_id} />}

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
          <LoadingSpinner size="sm" /> {t.common.loading}
        </div>
      )}

      {/* Tasks — ONE table merging ad-hoc to-dos + team-assignment steps
          (de-duped by title; team steps carry the responsible persona, status,
          output, and awaiting-review intervention). */}
      <Section icon={ListChecks} label={dl.goal_tasks_label}>
        <GoalTaskTable
          steps={steps}
          items={todoItems}
          personaById={personaById}
          onToggleItem={handleToggleItem}
          onDeleteItem={handleDeleteItem}
          onResolveStep={handleResolveStep}
        />
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

      {/* Browser UAT gate — web projects only. A verification item only a
          passing live browser test ticks; while open it keeps the goal under
          100% (the goal can't be marked done until UAT passes). Eligible to
          run only once the other to-dos are complete (final acceptance step). */}
      {(isWebProject || verifyItem) && (
        <Section icon={Globe} label={dl.uat_section_title}>
          {verifyItem ? (
            <div className="rounded-card border border-sky-500/25 bg-sky-500/[0.04] px-3 py-2.5">
              <div className="flex items-center gap-2">
                {verifyItem.done
                  ? <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <Globe className="w-4 h-4 text-sky-400 shrink-0" />}
                <span className="flex-1 typo-body text-foreground">
                  {verifyItem.done ? dl.uat_passed : dl.uat_pending}
                </span>
                {!verifyItem.done && (
                  <Button
                    variant="accent"
                    accentColor="sky"
                    size="sm"
                    icon={<Play className="w-3.5 h-3.5" />}
                    disabled={uatRunning || !todosComplete}
                    onClick={handleRunUat}
                  >
                    {uatRunning ? dl.uat_verifying : dl.uat_verify_now}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleClearUat}>{dl.uat_remove}</Button>
              </div>
              {!verifyItem.done && !todosComplete && (
                <p className="typo-caption text-amber-400 mt-1.5">{dl.uat_blocked_todos}</p>
              )}
              {!verifyItem.done && (
                <div className="flex items-center justify-between mt-1">
                  <p className="typo-caption text-foreground/60">{dl.uat_gate_hint}</p>
                  <button
                    type="button"
                    onClick={handleMarkUatPassed}
                    className="typo-caption text-foreground/50 hover:text-foreground/80 underline underline-offset-2 transition-colors shrink-0"
                  >
                    {dl.uat_mark_passed}
                  </button>
                </div>
              )}
            </div>
          ) : showUatForm ? (
            <div className="rounded-card border border-primary/10 bg-card/30 px-3 py-2.5 space-y-2">
              <label className="block typo-caption text-foreground/70">{dl.uat_scenario_label}</label>
              <textarea
                value={uatScenario}
                onChange={(e) => setUatScenario(e.target.value)}
                placeholder={dl.uat_scenario_placeholder}
                rows={2}
                className="w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/50 focus-ring"
              />
              <input
                value={uatUrl}
                onChange={(e) => setUatUrl(e.target.value)}
                placeholder={dl.uat_url_label}
                className="w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/50 focus-ring"
              />
              <div className="flex items-center gap-2">
                <Button variant="accent" accentColor="sky" size="sm" disabled={!uatScenario.trim()} onClick={handleSaveUat}>
                  {dl.uat_save}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowUatForm(false)}>{t.common.cancel}</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowUatForm(true)}>
              {dl.uat_add}
            </Button>
          )}
        </Section>
      )}

      {/* Sub-goals */}
      {subgoals.length > 0 && (
        <Section icon={Target} label={dl.goal_detail_subgoals}>
          <ul className="space-y-1.5">
            {subgoals.map((sg) => (
              <li key={sg.id} className="flex items-center gap-2.5 typo-body">
                {isComplete(sg.status) || sg.progress >= 100
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <Circle className="w-4 h-4 text-foreground shrink-0" />}
                <span className="flex-1 text-foreground truncate">{sg.title}</span>
                <span className="typo-caption text-foreground tabular-nums">{sg.progress}%</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Hand this goal to the project's AI team — plain-language control with
          an inline confirm. When the team is already on it, the same panel
          carries the "Stop the team" (abort) control. (The live team steps are
          now rows in the Tasks table above, so awaiting-review intervention is
          never buried.) */}
      {!isComplete(goal.status) && hasTeam && (
        <GoalHandoffPanel
          hasActiveAssignment={hasActiveAssignment}
          advancing={advancing}
          onAdvance={handleAdvance}
          onAbort={handleAbort}
          aborting={aborting}
        />
      )}

      {/* More details — secondary / power-user surfaces (dependency authoring,
          linked teams, raw activity) folded so the drawer leads with the human
          stuff a non-technical user needs first. Collapsed state persists. */}
      <SectionCard
        collapsible
        title={dl.goal_more_details}
        subtitle={dl.goal_more_details_hint}
        storageKey="goals.detailDrawer.moreDetails"
        defaultCollapsed
        size="sm"
        className="mt-3"
      >
      {/* Dependencies + follow-ups (always shown so the add pickers are reachable) */}
      <Section icon={GitMerge} label={dl.goal_detail_dependencies} flush>
        <div className="space-y-3">
          <DepGroup
            label={dl.goal_dep_depends_on}
            rows={blocksDeps}
            goalById={goalById}
            candidates={candidates}
            addPlaceholder={dl.goal_dep_add_depends_on}
            emptyLabel={dl.goal_dep_none}
            onAdd={(id) => addDep(id, DEP_BLOCKS)}
            onRemove={removeDep}
          />
          <DepGroup
            label={dl.goal_dep_follows}
            rows={followsDeps}
            goalById={goalById}
            candidates={candidates}
            addPlaceholder={dl.goal_dep_add_follows}
            emptyLabel={dl.goal_dep_none}
            onAdd={(id) => addDep(id, DEP_FOLLOWS)}
            onRemove={removeDep}
          />
        </div>
      </Section>

      {/* Linked team assignments */}
      {assignments.length > 0 && (
        <Section icon={Users} label={dl.goal_detail_linked_teams}>
          <ul className="space-y-1.5">
            {assignments.map((asgn) => (
              <li key={asgn.id} className="group flex items-center gap-2.5 typo-body">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${TEAM_CHIP}`}>
                  {tokenLabel(t, 'execution', asgn.status)}
                </span>
                <span className="flex-1 text-foreground truncate">{asgn.title}</span>
                <button
                  type="button"
                  onClick={() => handleUnlinkTeam(asgn.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-red-400 typo-caption"
                >
                  {dl.goal_unlink_team}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Activity feed */}
      {signals.length > 0 && (
        <Section icon={Activity} label={dl.goal_detail_activity}>
          <ul className="space-y-1.5">
            {signals.slice(0, 12).map((sig) => (
              <li key={sig.id} className="flex items-start gap-2 typo-caption text-foreground">
                <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-violet-400/60 shrink-0" />
                <span className="text-foreground line-clamp-2 min-w-0 flex-1">
                  {readableSignal(sig.message) ?? sig.signal_type}
                </span>
                <RelativeTime timestamp={sig.created_at} className="ml-auto text-foreground shrink-0" />
              </li>
            ))}
          </ul>
        </Section>
      )}
      </SectionCard>
    </BaseModal>
  );
}

/**
 * Make a goal signal readable. Older `team_step` signals stored the raw tail
 * of the execution output — agent-protocol JSON ({"emit_event":…},
 * {"outcome_assessment":…}) that rendered as truncated garbage. Extract the
 * human sentence in preference order: outcome_assessment.summary →
 * task_completed action → the message stripped of protocol JSON. Tolerant of
 * truncated fragments (regex on the key, not JSON.parse).
 */
function readableSignal(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  // Fast path: no protocol JSON in sight → already human text.
  if (!trimmed.includes('{"') && !trimmed.includes('"summary"') && !trimmed.includes('emit_event')) {
    return trimmed;
  }
  const grab = (key: string): string | null => {
    const m = trimmed.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m?.[1]) return null;
    const text = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
    return text.length > 8 ? text : null;
  };
  // Best: the agent's own outcome summary; then its task action line.
  const fromSummary = grab('summary');
  if (fromSummary) return fromSummary;
  const fromAction = grab('action');
  if (fromAction) return fromAction;
  // Last resort: drop JSON-ish chunks and keep whatever prose remains.
  const stripped = trimmed
    .replace(/\{"[\s\S]*?\}\}/g, ' ')
    .replace(/\{"[\s\S]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 12 ? stripped : null;
}

function Section({ icon: Icon, label, children, flush = false }: { icon: typeof Target; label: string; children: ReactNode; flush?: boolean }) {
  return (
    <div className={flush ? '' : 'pt-3 mt-3 border-t border-primary/10'}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-foreground" />
        <h3 className="typo-caption uppercase tracking-[0.18em] text-foreground">{label}</h3>
      </div>
      {children}
    </div>
  );
}

/** One dependency kind (Depends on / Follows): linked-goal rows + an add picker. */
function DepGroup({
  label, rows, goalById, candidates, addPlaceholder, emptyLabel, onAdd, onRemove,
}: {
  label: string;
  rows: DevGoalDependency[];
  goalById: Map<string, DevGoal>;
  candidates: DevGoal[];
  addPlaceholder: string;
  emptyLabel: string;
  onAdd: (dependsOnId: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <p className="typo-caption uppercase tracking-[0.16em] text-foreground mb-1">{label}</p>
      {rows.length > 0 ? (
        <ul className="space-y-1 mb-1.5">
          {rows.map((d) => {
            const linked = goalById.get(d.depends_on_id);
            return (
              <li key={d.id} className="group flex items-center gap-2 typo-body">
                <ArrowRight className="w-3.5 h-3.5 text-foreground shrink-0" />
                <span className="flex-1 text-foreground truncate">{linked?.title ?? d.depends_on_id}</span>
                {linked && <GoalStatusBadge status={linked.status} />}
                <button
                  type="button"
                  onClick={() => onRemove(d.id)}
                  aria-label={`Remove ${linked?.title ?? 'dependency'}`}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="typo-caption text-foreground italic mb-1.5">{emptyLabel}</p>
      )}
      {candidates.length > 0 && (
        <ThemedSelect value="" onValueChange={(v) => { if (v) onAdd(v); }}>
          <option value="">{addPlaceholder}</option>
          {candidates.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </ThemedSelect>
      )}
    </div>
  );
}
