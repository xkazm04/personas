/**
 * GoalsProgress — portfolio-level goals overview (Goals v2 L2 "Progress" view).
 *
 * Each project is a filmstrip: its goals are equal-size square frames laid in
 * strict chronological ORDER — not at exact date positions. Order carries the
 * chronology (past → future, left → right), which trades date fidelity for a
 * regular, scannable grid where dozens of goals across every project read in
 * one viewsight. Two in-row markers keep orientation: a violet rule at "now"
 * and a dashed rule before the dateless tail. Clicking a frame opens the goal
 * detail drawer; the "+" at the end of a row creates a goal in that project.
 *
 * A done-filter (All · 7D · None) controls how much completed history stays on
 * the strip, so finished work doesn't crowd out the live work.
 *
 * Always cross-project — the view exists to compare projects, so it ignores the
 * Board/Timeline scope switch. Internals live in progressShared.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { isComplete } from './goalStatus';
import { GoalAtmosphere } from './goalsTheme';
import {
  NODE_PX,
  GoalSquare,
  AddGoalButton,
  ProgressLegend,
  ProgressEmpty,
  useGoalsPortfolio,
  useGoalDrawer,
  groupByProject,
  anchorDate,
  isOverdue,
  isRecentlyDone,
} from './progressShared';

const LEFT_W = 200;

/** A frame on the strip: the goal plus everything its node needs, precomputed. */
interface StripNode {
  goal: DevGoal;
  overdue: boolean;
  /** Entry-animation stagger (ms). Baked in so memoized nodes get stable props. */
  delay: number;
}

/**
 * How much completed history the strip carries.
 * `all` — every done goal · `recent` — only those finished in the last 7 days ·
 * `none` — no done goals at all (live work only).
 *
 * Applied as CSS (the strip's `data-done-filter`, matched by `group-data-*`
 * variants on the nodes), NOT by rebuilding the node list — see GoalSquare's
 * header for why. This predicate exists only to COUNT what's hidden.
 */
type DoneFilter = 'all' | 'recent' | 'none';
const DONE_FILTER_KEY = 'personas.goals.progress.doneFilter';

function readDoneFilter(): DoneFilter {
  try {
    const v = localStorage.getItem(DONE_FILTER_KEY);
    return v === 'recent' || v === 'none' ? v : 'all';
  } catch (err) {
    silentCatch('GoalsProgress.readDoneFilter')(err);
    return 'all';
  }
}

/** Does this goal survive the done-filter? Ongoing goals always do. */
function passesFilter(g: DevGoal, filter: DoneFilter, now: number): boolean {
  if (!isComplete(g.status)) return true;
  if (filter === 'all') return true;
  if (filter === 'none') return false;
  return isRecentlyDone(g, now);
}

export function GoalsProgress() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { projects, allGoals, refresh } = useGoalsPortfolio();
  const { openGoal, createGoalIn, drawer } = useGoalDrawer(allGoals ?? [], refresh);
  const [doneFilter, setDoneFilter] = useState<DoneFilter>(readDoneFilter);

  const changeDoneFilter = (next: DoneFilter) => {
    setDoneFilter(next);
    try {
      localStorage.setItem(DONE_FILTER_KEY, next);
    } catch (err) {
      silentCatch('GoalsProgress.persistDoneFilter')(err);
    }
  };

  /**
   * The strip layout — ordered ONCE per data change and deliberately independent
   * of the done-filter. Every goal keeps a mounted node; the filter only decides
   * which ones are visible (see `hiddenIds` below). Rebuilding this list per
   * filter flip is what made the flip expensive: each of the ~230 completed
   * nodes would unmount and remount (Tooltip and all), ~300ms of jank for a
   * change that is really just "show/hide these squares".
   */
  const rows = useMemo(() => {
    const goals = allGoals ?? [];
    const now = Date.now();
    let nodeIndex = 0;
    const toNode = (g: DevGoal): StripNode => ({
      goal: g,
      overdue: isOverdue(g, now),
      delay: Math.min(nodeIndex++, 24) * 14,
    });

    return groupByProject(projects, goals).map((row) => {
      const dated = row.goals
        .map((g) => ({ g, at: anchorDate(g) }))
        .filter((x): x is { g: DevGoal; at: number } => x.at !== null)
        .sort((a, b) => a.at - b.at);
      return {
        ...row,
        past: dated.filter((x) => x.at < now).map((x) => toNode(x.g)),
        future: dated.filter((x) => x.at >= now).map((x) => toNode(x.g)),
        undated: row.goals.filter((g) => anchorDate(g) === null).map(toNode),
      };
    });
  }, [allGoals, projects]);

  /**
   * The filter's only JS-side output: which goals the CSS is hiding. Drives the
   * counts and the per-row dashed rule — never the node list itself.
   */
  const hiddenIds = useMemo(() => {
    const now = Date.now();
    const hidden = new Set<string>();
    if (doneFilter === 'all') return hidden;
    for (const g of allGoals ?? []) {
      if (!passesFilter(g, doneFilter, now)) hidden.add(g.id);
    }
    return hidden;
  }, [allGoals, doneFilter]);

  // Still fetching — render nothing rather than flashing the empty state.
  if (allGoals === null) return null;
  if (rows.length === 0) return <ProgressEmpty dl={dl} />;

  const hiddenGoals = hiddenIds.size;
  const shownGoals = allGoals.length - hiddenGoals;

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />

      {/* Control row: status key (left) + how much done-history to carry (right). */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <ProgressLegend dl={dl} />
        <div className="flex items-center gap-2">
          <span className="typo-caption text-foreground uppercase tracking-wider">
            {dl.goal_status_done}
          </span>
          <SegmentedTabs<DoneFilter>
            variant="segment"
            fullWidth={false}
            ariaLabel={dl.progress_filter_done_aria}
            activeTab={doneFilter}
            onTabChange={changeDoneFilter}
            tabs={[
              { id: 'all', label: dl.progress_filter_all },
              { id: 'recent', label: dl.progress_filter_recent },
              { id: 'none', label: dl.progress_filter_none },
            ]}
          />
        </div>
      </div>

      {/* The strip owns the filter: nodes carry static `group-data-[done-filter=…]`
          hide-rules, so flipping this attribute is a style recalc — no node
          re-renders, no remounts. */}
      <div
        data-done-filter={doneFilter}
        className="group/strip relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden"
      >
        {/* Header — summary + the strip's reading direction. */}
        <div className="flex items-center border-b border-primary/10 bg-secondary/20">
          <div className="shrink-0 px-3 py-2" style={{ width: LEFT_W }}>
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: shownGoals })}
            </span>
          </div>
          <div className="flex-1 flex items-center gap-2 px-1 py-2">
            <span className="typo-caption text-foreground uppercase tracking-wider">
              {dl.progress_past}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-primary/20 to-violet-400/40" />
            <span className="px-1.5 py-px rounded-full border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300">
              {dl.progress_today}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-violet-400/40 to-primary/20" />
            <span className="typo-caption text-foreground uppercase tracking-wider">
              {dl.progress_future}
            </span>
          </div>
          <div className="shrink-0 px-3 py-2">
            <span className="typo-caption text-foreground uppercase tracking-wider">
              {dl.progress_no_date}
            </span>
          </div>
        </div>

        {rows.map((row) => (
          <div
            key={row.projectId}
            data-testid={`progress-row-${row.projectId}`}
            className="flex items-stretch border-b border-primary/5 last:border-b-0 transition-colors hover:bg-primary/[0.03]"
          >
            <div
              className="shrink-0 px-3 py-2.5 flex flex-col justify-center gap-0.5 min-w-0 border-r border-primary/5"
              style={{ width: LEFT_W }}
            >
              <span className="typo-body text-foreground font-medium truncate" title={row.name}>
                {row.name}
              </span>
              <span className="typo-caption text-foreground tabular-nums">
                {tx(dl.progress_row_counts, { active: row.activeCount, done: row.doneCount })}
              </span>
            </div>

            {/* The strip: uniform-pitch frames in chronological order, wrapping. */}
            <div
              className="flex-1 flex flex-wrap items-center content-center gap-1.5 px-3 py-2.5"
              style={{ minHeight: NODE_PX + 20 }}
            >
              {row.past.map((n) => (
                <GoalSquare
                  key={n.goal.id}
                  goal={n.goal}
                  overdue={n.overdue}
                  delay={n.delay}
                  dl={dl}
                  onOpen={openGoal}
                />
              ))}
              {/* "Now" rule — everything left is behind us, right is ahead. */}
              <Tooltip content={dl.progress_today}>
                <span
                  aria-hidden="true"
                  className="w-0.5 rounded-full bg-violet-400/70 mx-0.5"
                  style={{ height: NODE_PX }}
                />
              </Tooltip>
              {row.future.map((n) => (
                <GoalSquare
                  key={n.goal.id}
                  goal={n.goal}
                  overdue={n.overdue}
                  delay={n.delay}
                  dl={dl}
                  onOpen={openGoal}
                />
              ))}
              {/* The dashed rule only earns its place when a dateless goal is
                  actually visible — but the nodes themselves stay mounted so a
                  filter flip never remounts them. */}
              {row.undated.some((n) => !hiddenIds.has(n.goal.id)) && (
                <Tooltip content={dl.progress_no_date}>
                  <span
                    aria-hidden="true"
                    className="border-l border-dashed border-primary/30 mx-0.5"
                    style={{ height: NODE_PX }}
                  />
                </Tooltip>
              )}
              {row.undated.map((n) => (
                <GoalSquare
                  key={n.goal.id}
                  goal={n.goal}
                  overdue={n.overdue}
                  delay={n.delay}
                  dl={dl}
                  onOpen={openGoal}
                />
              ))}

              {/* Tail: the next empty frame — authors a goal in THIS project. */}
              <AddGoalButton
                projectName={row.name}
                label={dl.goal_new_title}
                onClick={() => createGoalIn(row.projectId)}
              />
            </div>
          </div>
        ))}

        {/* Honest footer: the filter hides goals; say how many. */}
        {hiddenGoals > 0 && (
          <div className="px-3 py-1.5 border-t border-primary/5 bg-secondary/10 text-right">
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_hidden_note, { count: hiddenGoals })}
            </span>
          </div>
        )}
      </div>

      {drawer}
    </div>
  );
}

export default GoalsProgress;
