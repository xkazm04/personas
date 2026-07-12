/**
 * GoalsProgress — portfolio-level goals overview (Goals v2 L2 "Progress" view).
 *
 * One row per project, a shared time axis running left → right, and every goal
 * rendered as a small square node positioned by its target date (done goals sit
 * at their completion date) and colored by status. Dozens of goals across all
 * projects read in one viewsight; clicking a node opens the goal detail drawer.
 * Goals without a date collect in a per-row tray on the right edge. Always
 * cross-project — the view exists to compare projects, so it ignores the
 * Board/Timeline scope switch.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChartNoAxesGantt } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { Translations } from '@/i18n/en';
import { isOngoing, isComplete, goalStatusMeta, goalStatusLabel, GOAL_STATUSES } from './goalStatus';
import { GoalAtmosphere } from './goalsTheme';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';

const DAY = 86400000;
/** Fixed side-column widths so the axis overlay + node tracks share one scale. */
const LEFT_W = 200;
const TRAY_W = 108;
/** Cluster resolution — nodes quantized to the same slot stack vertically. */
const SLOTS = 64;
/** Vertical distance between stacked nodes (px). */
const STACK_STEP = 11;
/** Max squares drawn per stack; the rest collapse into a "+N" count. */
const STACK_CAP = 5;

type DevLifecycleT = Translations['plugins']['dev_lifecycle'];

/** The date a goal is plotted at — completion beats target once it's done. */
function anchorDate(g: DevGoal): number | null {
  const raw = isComplete(g.status) ? (g.completed_at ?? g.target_date) : g.target_date;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

interface PlottedGoal {
  goal: DevGoal;
  /** 0..1 position along the time domain (already clamped). */
  frac: number;
  overdue: boolean;
}

interface ProjectRow {
  projectId: string;
  name: string;
  activeCount: number;
  doneCount: number;
  /** Slot → stacked nodes, precomputed so row height is known up front. */
  stacks: Array<{ frac: number; nodes: PlottedGoal[] }>;
  undated: DevGoal[];
  maxStack: number;
}

/** First-of-month ticks inside the domain, as axis fractions. */
function monthTicks(start: number, end: number): Array<{ frac: number; label: string }> {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const ticks: Array<{ frac: number; label: string }> = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  if (d.getTime() < start) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= end) {
    const frac = (d.getTime() - start) / (end - start);
    if (frac > 0.015 && frac < 0.985) ticks.push({ frac, label: fmt.format(d) });
    d.setMonth(d.getMonth() + 1);
  }
  // Crowded axis (year-plus domains): keep every other label, lines stay.
  if (ticks.length > 9) return ticks.map((t, i) => (i % 2 === 0 ? t : { ...t, label: '' }));
  return ticks;
}

/** Compact tooltip line — the drawer carries the full story. */
function nodeTooltip(dl: DevLifecycleT, g: DevGoal): string {
  const parts = [g.title, goalStatusLabel(dl, g.status), `${g.progress}%`];
  const at = anchorDate(g);
  if (at !== null) {
    parts.push(new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  return parts.join(' · ');
}

function GoalSquare({
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
        className={`animate-fade-slide-in block w-2.5 h-2.5 rounded-[3px] border border-background/80 transition-transform duration-150 hover:scale-[1.4] hover:z-20 motion-reduce:transform-none focus-ring ${done ? 'opacity-60 hover:opacity-100' : ''}`}
      />
    </Tooltip>
  );
}

export function GoalsProgress() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  // Fetched directly (not through the store's active-project goals array) so
  // the portfolio never depends on which project is currently picked.
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

  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);

  const { rows, domain, totalGoals } = useMemo(() => {
    const goals = allGoals ?? [];
    const now = Date.now();

    // Time domain: every plottable date ∪ today, padded, clamped to a window
    // that keeps the recent past + near future readable even with far outliers.
    let min = now;
    let max = now;
    for (const g of goals) {
      const at = anchorDate(g);
      if (at === null) continue;
      if (at < min) min = at;
      if (at > max) max = at;
    }
    const pad = Math.max(4 * DAY, (max - min) * 0.06);
    let start = Math.max(min - pad, now - 180 * DAY);
    let end = Math.min(max + pad, now + 240 * DAY);
    if (end - start < 42 * DAY) {
      // Sparse data — hold a ~6-week window so nodes don't smear edge-to-edge.
      start = Math.min(start, now - 14 * DAY);
      end = start + 42 * DAY;
    }
    const span = end - start;
    const toFrac = (ts: number) => Math.min(0.995, Math.max(0.005, (ts - start) / span));

    const byProject = new Map<string, DevGoal[]>();
    for (const g of goals) {
      const list = byProject.get(g.project_id);
      if (list) list.push(g);
      else byProject.set(g.project_id, [g]);
    }

    const rows: ProjectRow[] = [];
    for (const p of projects) {
      if (p.status === 'archived') continue;
      const projectGoals = byProject.get(p.id);
      if (!projectGoals?.length) continue;

      const slots = new Map<number, PlottedGoal[]>();
      const undated: DevGoal[] = [];
      for (const g of projectGoals) {
        const at = anchorDate(g);
        if (at === null) {
          undated.push(g);
          continue;
        }
        const frac = toFrac(at);
        const plotted: PlottedGoal = { goal: g, frac, overdue: at < now && isOngoing(g.status) };
        const slot = Math.round(frac * SLOTS);
        const stack = slots.get(slot);
        if (stack) stack.push(plotted);
        else slots.set(slot, [plotted]);
      }

      const stacks = [...slots.values()]
        .map((nodes) => ({
          // Ongoing above done inside a stack — the live work stays visible.
          nodes: nodes.sort((a, b) => Number(isComplete(a.goal.status)) - Number(isComplete(b.goal.status))),
          frac: nodes.reduce((s, n) => s + n.frac, 0) / nodes.length,
        }))
        .sort((a, b) => a.frac - b.frac);

      rows.push({
        projectId: p.id,
        name: p.name,
        activeCount: projectGoals.filter((g) => isOngoing(g.status)).length,
        doneCount: projectGoals.filter((g) => isComplete(g.status)).length,
        stacks,
        undated,
        maxStack: stacks.reduce((m, s) => Math.max(m, Math.min(s.nodes.length, STACK_CAP)), 1),
      });
    }
    rows.sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));

    return {
      rows,
      domain: { start, end, todayFrac: toFrac(now), ticks: monthTicks(start, end) },
      totalGoals: goals.length,
    };
  }, [allGoals, projects]);

  const allGoalsList = allGoals ?? [];

  // Still fetching — render nothing rather than flashing the empty state.
  if (allGoals === null) return null;

  if (rows.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center py-16 text-center">
        <GoalAtmosphere />
        <ChartNoAxesGantt className="w-10 h-10 text-foreground mb-3" />
        <h3 className="typo-section-title text-foreground">{dl.progress_empty_title}</h3>
        <p className="typo-body text-foreground mt-1 max-w-md">{dl.progress_empty_sub}</p>
      </div>
    );
  }

  let nodeIndex = 0;
  const stagger = () => Math.min(nodeIndex++, 24) * 18;

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />

      {/* Status legend — the color key for every square below. */}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 mb-3">
        {GOAL_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-[2px]"
              style={{ backgroundColor: goalStatusMeta(s).map.fill }}
            />
            <span className="typo-caption text-foreground">{goalStatusLabel(dl, s)}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-[2px] bg-amber-400"
            style={{ boxShadow: '0 0 0 1.5px rgba(239,68,68,0.75)' }}
          />
          <span className="typo-caption text-foreground">{dl.timeline_overdue_group}</span>
        </span>
      </div>

      <div className="relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden">
        {/* Time grid overlay — month lines + today, spanning every row. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0"
          style={{ left: LEFT_W, right: TRAY_W }}
        >
          {domain.ticks.map((tick, i) => (
            <div
              key={i}
              className="absolute inset-y-0 w-px bg-primary/5"
              style={{ left: `${tick.frac * 100}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 w-px bg-violet-400/40"
            style={{ left: `${domain.todayFrac * 100}%` }}
          />
        </div>

        {/* Axis header */}
        <div className="relative flex items-stretch border-b border-primary/10 bg-secondary/20">
          <div className="shrink-0 px-3 py-2" style={{ width: LEFT_W }}>
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: totalGoals })}
            </span>
          </div>
          <div className="relative flex-1 min-h-7">
            {domain.ticks.map((tick, i) =>
              tick.label ? (
                <span
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 typo-caption text-foreground uppercase tracking-wider"
                  style={{ left: `${tick.frac * 100}%` }}
                >
                  {tick.label}
                </span>
              ) : null,
            )}
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-px rounded-full border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300"
              style={{ left: `${domain.todayFrac * 100}%` }}
            >
              {dl.progress_today}
            </span>
          </div>
          <div
            className="shrink-0 flex items-center pl-3 border-l border-dashed border-primary/10"
            style={{ width: TRAY_W }}
          >
            <span className="typo-caption text-foreground uppercase tracking-wider truncate">
              {dl.progress_no_date}
            </span>
          </div>
        </div>

        {/* Project rows */}
        {rows.map((row) => {
          const rowH = Math.max(44, row.maxStack * STACK_STEP + 26);
          return (
            <div
              key={row.projectId}
              data-testid={`progress-row-${row.projectId}`}
              className="relative flex items-stretch border-b border-primary/5 last:border-b-0 transition-colors hover:bg-primary/[0.03]"
            >
              <div
                className="shrink-0 px-3 flex flex-col justify-center gap-0.5 min-w-0"
                style={{ width: LEFT_W }}
              >
                <span className="typo-body text-foreground font-medium truncate" title={row.name}>
                  {row.name}
                </span>
                <span className="typo-caption text-foreground tabular-nums">
                  {tx(dl.progress_row_counts, { active: row.activeCount, done: row.doneCount })}
                </span>
              </div>

              <div className="relative flex-1" style={{ minHeight: rowH }}>
                {/* Baseline — anchors the row even where no nodes land. */}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-primary/10 via-primary/[0.07] to-transparent" />
                {row.stacks.map((stack, si) => {
                  const visible = stack.nodes.slice(0, STACK_CAP);
                  const hidden = stack.nodes.length - visible.length;
                  return visible
                    .map((n, ni) => {
                      const offsetY = (ni - (visible.length - 1) / 2) * STACK_STEP;
                      return (
                        <span
                          key={n.goal.id}
                          className="absolute"
                          style={{
                            left: `${n.frac * 100}%`,
                            top: '50%',
                            transform: `translate(-50%, calc(-50% + ${offsetY}px))`,
                          }}
                        >
                          <GoalSquare
                            goal={n.goal}
                            overdue={n.overdue}
                            delay={stagger()}
                            dl={dl}
                            onOpen={setDetailGoalId}
                          />
                        </span>
                      );
                    })
                    .concat(
                      hidden > 0
                        ? [
                            <span
                              key={`overflow-${si}`}
                              className="absolute -translate-x-1/2 typo-caption text-foreground tabular-nums"
                              style={{
                                left: `${stack.frac * 100}%`,
                                top: `calc(50% + ${((visible.length - 1) / 2) * STACK_STEP + 8}px)`,
                              }}
                            >
                              +{hidden}
                            </span>,
                          ]
                        : [],
                    );
                })}
              </div>

              <div
                className="shrink-0 flex flex-wrap content-center items-center gap-1.5 pl-3 pr-2 py-2 border-l border-dashed border-primary/10"
                style={{ width: TRAY_W }}
              >
                {row.undated.map((g) => (
                  <GoalSquare
                    key={g.id}
                    goal={g}
                    overdue={false}
                    delay={stagger()}
                    dl={dl}
                    onOpen={setDetailGoalId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        goalFallback={allGoalsList.find((g) => g.id === detailGoalId) ?? null}
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
    </div>
  );
}

export default GoalsProgress;
