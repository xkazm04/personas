/**
 * Internal toolkit for the Progress view (the portfolio filmstrip).
 *
 * Holds the cross-project data hook, the detail-drawer/editor wiring, the goal
 * node, the status legend, and the empty state — the pieces GoalsProgress
 * composes. Kept as a separate module so the view file stays about layout.
 */
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChartNoAxesGantt, Plus } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { Translations } from '@/i18n/en';
import { isOngoing, isComplete, goalStatusMeta, goalStatusLabel, GOAL_STATUSES } from './goalStatus';
import { GoalAtmosphere } from './goalsTheme';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';

export const DAY = 86400000;

export type DevLifecycleT = Translations['plugins']['dev_lifecycle'];

/** The date a goal is plotted/ordered by — completion beats target once done. */
export function anchorDate(g: DevGoal): number | null {
  const raw = isComplete(g.status) ? (g.completed_at ?? g.target_date) : g.target_date;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Ongoing goal whose anchor date is already behind us. */
export function isOverdue(g: DevGoal, now: number): boolean {
  const at = anchorDate(g);
  return at !== null && at < now && isOngoing(g.status);
}

/** The done-filter's recency window. */
export const RECENT_WINDOW = 7 * DAY;

/**
 * Completed inside the recency window — the single definition behind BOTH the
 * node's CSS hide-rule and the "N hidden" count, so the two can't disagree. A
 * done goal with no completion stamp has no recency to prove and counts as old
 * history (not recent).
 */
export function isRecentlyDone(g: DevGoal, now: number = Date.now()): boolean {
  if (!isComplete(g.status)) return false;
  const at = anchorDate(g);
  return at !== null && now - at <= RECENT_WINDOW;
}

/** Compact tooltip line — the drawer carries the full story. */
export function nodeTooltip(dl: DevLifecycleT, g: DevGoal): string {
  const parts = [g.title, goalStatusLabel(dl, g.status), `${g.progress}%`];
  const at = anchorDate(g);
  if (at !== null) {
    parts.push(new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  return parts.join(' · ');
}

/**
 * Cross-project portfolio data: all projects + all goals, fetched directly (not
 * via the store's active-project goals array) so the view never depends on which
 * project is currently picked. `refresh` re-pulls after a mutation (create/edit
 * lands in the store, not in this local copy).
 */
export function useGoalsPortfolio(): {
  projects: DevProject[];
  allGoals: DevGoal[] | null;
  refresh: () => void;
} {
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [allGoals, setAllGoals] = useState<DevGoal[] | null>(null);

  const load = useCallback(() => {
    void devApi
      .listAllGoals()
      .then(setAllGoals)
      .catch(silentCatch('GoalsProgress.allGoals'));
  }, []);

  useEffect(() => {
    void fetchProjects?.();
    load();
  }, [fetchProjects, load]);

  return { projects, allGoals, refresh: load };
}

export interface PortfolioProjectGoals {
  projectId: string;
  name: string;
  goals: DevGoal[];
  activeCount: number;
  doneCount: number;
}

/** Non-archived projects that own goals, busiest first. */
export function groupByProject(projects: DevProject[], goals: DevGoal[]): PortfolioProjectGoals[] {
  const byProject = new Map<string, DevGoal[]>();
  for (const g of goals) {
    const list = byProject.get(g.project_id);
    if (list) list.push(g);
    else byProject.set(g.project_id, [g]);
  }
  const rows: PortfolioProjectGoals[] = [];
  for (const p of projects) {
    if (p.status === 'archived') continue;
    const projectGoals = byProject.get(p.id);
    if (!projectGoals?.length) continue;
    rows.push({
      projectId: p.id,
      name: p.name,
      goals: projectGoals,
      activeCount: projectGoals.filter((g) => isOngoing(g.status)).length,
      doneCount: projectGoals.filter((g) => isComplete(g.status)).length,
    });
  }
  rows.sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));
  return rows;
}

/**
 * Detail-drawer + goal-editor wiring. `openGoal` opens an existing goal;
 * `createGoalIn` opens the editor in create mode with the project prefilled (the
 * per-row "+" affordance). Both mutate through the store, so every close calls
 * `onMutated` to re-pull the portfolio's own copy of the goals.
 */
export function useGoalDrawer(
  goals: DevGoal[],
  onMutated: () => void,
): {
  openGoal: (id: string) => void;
  createGoalIn: (projectId: string) => void;
  drawer: ReactNode;
} {
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);
  const [createProjectId, setCreateProjectId] = useState<string | null>(null);

  const closeDetail = () => {
    setDetailGoalId(null);
    onMutated();
  };
  const closeEditor = () => {
    setEditGoal(null);
    setCreateProjectId(null);
    onMutated();
  };

  const drawer = (
    <>
      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        goalFallback={goals.find((g) => g.id === detailGoalId) ?? null}
        onClose={closeDetail}
        onEdit={(g) => { setDetailGoalId(null); setEditGoal(g); }}
      />
      {(editGoal || createProjectId) && (
        <GoalEditorModal
          isOpen
          editGoal={editGoal}
          projectId={editGoal?.project_id ?? createProjectId!}
          onClose={closeEditor}
        />
      )}
    </>
  );

  return { openGoal: setDetailGoalId, createGoalIn: setCreateProjectId, drawer };
}

/** Node edge length (px) — the filmstrip's unit of pitch. */
export const NODE_PX = 20;

/**
 * The goal node: a status-filled square carrying an inner progress bar while the
 * goal is ongoing (a done goal reads as complete without one) and a red ring
 * when it's overdue.
 *
 * PERF — why the done-filter lives in CSS, not in props:
 * a portfolio row holds hundreds of these and each mounts a Tooltip (measured
 * ~0.7ms apiece, ~150ms for 226). Both obvious approaches re-touch every node on
 * a filter flip — dropping them from the tree remounts them (~300ms of jank),
 * and a `filtered` prop re-renders them (no better). So the filter is expressed
 * as `group-data-*` variants instead: the node's classes depend only on the
 * goal, the STRIP carries the active filter as a data attribute, and flipping it
 * is a style recalc that re-renders exactly zero nodes (the memo below then
 * holds on every parent re-render). `display:none` also takes hidden nodes out
 * of the a11y tree for free.
 */
export const GoalSquare = memo(function GoalSquare({
  goal,
  overdue,
  delay,
  dl,
  onOpen,
}: {
  goal: DevGoal;
  overdue: boolean;
  delay: number;
  dl: DevLifecycleT;
  onOpen: (id: string) => void;
}) {
  const meta = goalStatusMeta(goal.status);
  const done = isComplete(goal.status);
  const ring = overdue ? '0 0 0 1.5px rgba(239,68,68,0.75), ' : '';
  // Hide rules, keyed off the strip's data-done-filter. A done goal always
  // vanishes under `none`; under `recent` it vanishes unless it finished inside
  // the window (a done goal with no completion stamp has no recency to prove,
  // so it counts as old history).
  const filterCls = done
    ? `group-data-[done-filter=none]/strip:hidden ${
        isRecentlyDone(goal) ? '' : 'group-data-[done-filter=recent]/strip:hidden'
      }`
    : '';
  return (
    <Tooltip content={nodeTooltip(dl, goal)}>
      <button
        type="button"
        onClick={() => onOpen(goal.id)}
        aria-label={`${goal.title} — ${goalStatusLabel(dl, goal.status)}`}
        style={{
          width: NODE_PX,
          height: NODE_PX,
          backgroundColor: meta.map.fill,
          boxShadow: `${ring}0 0 8px -1px ${meta.map.glow}`,
          animationDelay: `${delay}ms`,
        }}
        className={`animate-fade-slide-in relative block overflow-hidden rounded-[5px] border border-background/80 transition-transform duration-150 hover:scale-125 hover:z-20 motion-reduce:transform-none focus-ring ${done ? 'opacity-60 hover:opacity-100' : ''} ${filterCls}`}
      >
        {!done && (
          <span className="absolute inset-x-[3px] bottom-[3px] h-[3px] rounded-full bg-background/35 overflow-hidden">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/90"
              style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }}
            />
          </span>
        )}
      </button>
    </Tooltip>
  );
});

/**
 * Row-tail "+" affordance — same footprint as a goal node, so it reads as the
 * next empty frame in the strip. Opens the goal editor with this row's project
 * already selected. No tooltip by design: the dashed empty frame is
 * self-evident, and a hover card on every row is noise. The accessible name
 * still carries the project.
 */
export function AddGoalButton({
  projectName,
  label,
  onClick,
}: {
  projectName: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} — ${projectName}`}
      style={{ width: NODE_PX, height: NODE_PX }}
      className="flex items-center justify-center rounded-[5px] border border-dashed border-primary/25 text-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-300 focus-ring"
    >
      <Plus className="w-3 h-3" />
    </button>
  );
}

/** Status color key shown above the grid. */
export function ProgressLegend({ dl }: { dl: DevLifecycleT }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {GOAL_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-[3px]"
            style={{ backgroundColor: goalStatusMeta(s).map.fill }}
          />
          <span className="typo-caption text-foreground">{goalStatusLabel(dl, s)}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-[3px] bg-amber-400"
          style={{ boxShadow: '0 0 0 1.5px rgba(239,68,68,0.75)' }}
        />
        <span className="typo-caption text-foreground">{dl.timeline_overdue_group}</span>
      </span>
    </div>
  );
}

/** Shared empty state — no goals anywhere in the portfolio. */
export function ProgressEmpty({ dl }: { dl: DevLifecycleT }) {
  return (
    <div className="relative flex flex-col items-center justify-center py-16 text-center">
      <GoalAtmosphere />
      <ChartNoAxesGantt className="w-10 h-10 text-foreground mb-3" />
      <h3 className="typo-section-title text-foreground">{dl.progress_empty_title}</h3>
      <p className="typo-body text-foreground mt-1 max-w-md">{dl.progress_empty_sub}</p>
    </div>
  );
}
