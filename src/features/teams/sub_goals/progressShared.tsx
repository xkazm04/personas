/**
 * Shared primitives for the Progress-view prototype round (baseline + variants).
 *
 * Hoisted out of GoalsProgress so the directional variants (Sequence, Buckets)
 * compose from the same data hook, drawer wiring, legend, and goal-square node
 * instead of forking them. Survives consolidation as the Progress view's
 * internal toolkit; the variant files themselves are throwaway.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChartNoAxesGantt } from 'lucide-react';
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

/** Compact tooltip line — the drawer carries the full story. */
export function nodeTooltip(dl: DevLifecycleT, g: DevGoal): string {
  const parts = [g.title, goalStatusLabel(dl, g.status), `${g.progress}%`];
  const at = anchorDate(g);
  if (at !== null) {
    parts.push(new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  return parts.join(' · ');
}

/** Cross-project portfolio data: all projects + all goals, fetched directly. */
export function useGoalsPortfolio(): { projects: DevProject[]; allGoals: DevGoal[] | null } {
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [allGoals, setAllGoals] = useState<DevGoal[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchProjects?.();
    void devApi
      .listAllGoals()
      .then((g) => { if (!cancelled) setAllGoals(g); })
      .catch(silentCatch('GoalsProgress.allGoals'));
    return () => { cancelled = true; };
  }, [fetchProjects]);
  return { projects, allGoals };
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

/** Detail-drawer + editor wiring shared by every variant. */
export function useGoalDrawer(goals: DevGoal[]): { openGoal: (id: string) => void; drawer: ReactNode } {
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);
  const drawer = (
    <>
      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        goalFallback={goals.find((g) => g.id === detailGoalId) ?? null}
        onClose={() => setDetailGoalId(null)}
        onEdit={(g) => { setDetailGoalId(null); setEditGoal(g); }}
      />
      {editGoal && (
        <GoalEditorModal
          isOpen
          editGoal={editGoal}
          projectId={editGoal.project_id}
          onClose={() => setEditGoal(null)}
        />
      )}
    </>
  );
  return { openGoal: setDetailGoalId, drawer };
}

/**
 * The goal node. `sm` = the original 10px square (baseline). `lg` = the 20px
 * square: same status fill, plus an inner mini progress bar on ongoing goals
 * (done goals read as complete without one).
 */
export function GoalSquare({
  goal,
  overdue,
  delay,
  dl,
  onOpen,
  size = 'sm',
}: {
  goal: DevGoal;
  overdue: boolean;
  delay: number;
  dl: DevLifecycleT;
  onOpen: (id: string) => void;
  size?: 'sm' | 'lg';
}) {
  const meta = goalStatusMeta(goal.status);
  const done = isComplete(goal.status);
  const ring = overdue ? '0 0 0 1.5px rgba(239,68,68,0.75), ' : '';
  const sizeCls =
    size === 'lg'
      ? 'w-5 h-5 rounded-[5px] hover:scale-125'
      : 'w-2.5 h-2.5 rounded-[3px] hover:scale-[1.4]';
  return (
    <Tooltip content={nodeTooltip(dl, goal)}>
      <button
        type="button"
        onClick={() => onOpen(goal.id)}
        aria-label={`${goal.title} — ${goalStatusLabel(dl, goal.status)}`}
        style={{
          backgroundColor: meta.map.fill,
          boxShadow: `${ring}0 0 8px -1px ${meta.map.glow}`,
          animationDelay: `${delay}ms`,
        }}
        className={`animate-fade-slide-in relative block overflow-hidden border border-background/80 transition-transform duration-150 hover:z-20 motion-reduce:transform-none focus-ring ${sizeCls} ${done ? 'opacity-60 hover:opacity-100' : ''}`}
      >
        {size === 'lg' && !done && (
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
}

/** Status color key shown above every variant's grid. */
export function ProgressLegend({ dl, size = 'sm' }: { dl: DevLifecycleT; size?: 'sm' | 'lg' }) {
  const swatch = size === 'lg' ? 'w-3 h-3 rounded-[3px]' : 'w-2 h-2 rounded-[2px]';
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 mb-3">
      {GOAL_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={swatch} style={{ backgroundColor: goalStatusMeta(s).map.fill }} />
          <span className="typo-caption text-foreground">{goalStatusLabel(dl, s)}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`${swatch} bg-amber-400`}
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
