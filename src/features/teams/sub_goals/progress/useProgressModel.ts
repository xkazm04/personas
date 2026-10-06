/**
 * The Progress view's DATA MODEL - fetching, filtering and row shaping for the
 * portfolio of goals, with no opinion at all about how a row is drawn.
 *
 * Extracted from GoalsProgress (2026-10-06) so several layout variants can read
 * the same numbers: a variant is then layout plus styling, never a second copy
 * of the chronology rules. The view file is layout only.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { inPickerScope, type PickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { isComplete } from '../goalStatus';
import {
  useGoalsPortfolio,
  groupByProject,
  anchorDate,
  isOverdue,
  isRecentlyDone,
  type PortfolioProjectGoals,
} from '../progressShared';

/**
 * How much completed history the view carries.
 * `all` - every done goal · `recent` - only those finished in the last 7 days ·
 * `none` - no done goals at all (live work only).
 */
export type DoneFilter = 'all' | 'recent' | 'none';
const DONE_FILTER_KEY = 'personas.goals.progress.doneFilter';

function readDoneFilter(): DoneFilter {
  try {
    const v = localStorage.getItem(DONE_FILTER_KEY);
    return v === 'all' || v === 'recent' || v === 'none' ? v : 'recent';
  } catch (err) {
    silentCatch('GoalsProgress.readDoneFilter')(err);
    return 'recent';
  }
}

/** Does this goal survive the done-filter? Ongoing goals always do. */
export function passesFilter(g: DevGoal, filter: DoneFilter, now: number): boolean {
  if (!isComplete(g.status)) return true;
  if (filter === 'all') return true;
  if (filter === 'none') return false;
  return isRecentlyDone(g, now);
}

/** A frame on the strip: the goal plus everything its node needs, precomputed. */
export interface ProgressNode {
  goal: DevGoal;
  overdue: boolean;
  /**
   * Entry-animation stagger (ms), or `null` once the one-shot cascade has
   * already played. Baked in so memoized nodes get stable props.
   */
  delay: number | null;
}

export interface ProgressRow extends PortfolioProjectGoals {
  /** Dated and behind us, oldest first. */
  past: ProgressNode[];
  /** Dated and ahead of us, soonest first. */
  future: ProgressNode[];
  /** No usable anchor date - the strip's tail. */
  undated: ProgressNode[];
  /** Every node of the row in reading order, for layouts that do not split. */
  nodes: ProgressNode[];
}

export interface ProgressModel {
  doneFilter: DoneFilter;
  setDoneFilter: (next: DoneFilter) => void;
  /** `null` while the first portfolio fetch is in flight. */
  allGoals: DevGoal[] | null;
  rows: ProgressRow[];
  /** Goals the done-filter is hiding in CSS - drives the counts, never the list. */
  hiddenIds: ReadonlySet<string>;
  shownGoals: number;
  hiddenGoals: number;
  /** Re-pull the portfolio after a mutation lands. */
  refresh: () => void;
}

export function useProgressModel(projectScope?: PickerScope): ProgressModel {
  const [doneFilter, setFilter] = useState<DoneFilter>(readDoneFilter);
  const { projects, allGoals: portfolioGoals, refresh } = useGoalsPortfolio(doneFilter);

  // The header picker's workspace / project filters the portfolio.
  const allGoals = useMemo(
    () =>
      portfolioGoals && projectScope
        ? portfolioGoals.filter((g) => inPickerScope(projectScope, g.project_id))
        : portfolioGoals,
    [portfolioGoals, projectScope],
  );

  const setDoneFilter = useCallback((next: DoneFilter) => {
    setFilter(next);
    try {
      localStorage.setItem(DONE_FILTER_KEY, next);
    } catch (err) {
      silentCatch('GoalsProgress.persistDoneFilter')(err);
    }
  }, []);

  /**
   * One-shot guard for the node entrance cascade: latches true the first time
   * `rows` is built from real (non-null) data. Every later rebuild - a drawer
   * close calling `refresh()`, a poll, a projects refetch - bakes `null` delays
   * instead, so nodes render plainly. Ungated, this replayed the cascade on
   * every refresh: the nodes never unmount (stable `goal.id` keys), but rebaking
   * a fresh `animationDelay` on an already-finished CSS animation is enough for
   * some browsers to run it again.
   */
  const hasEnteredOnceRef = useRef(false);

  const rows = useMemo<ProgressRow[]>(() => {
    const now = Date.now();
    const goals = (allGoals ?? []).filter((g) => passesFilter(g, doneFilter, now));
    const playEntrance = allGoals !== null && !hasEnteredOnceRef.current;
    let nodeIndex = 0;
    const toNode = (g: DevGoal): ProgressNode => ({
      goal: g,
      overdue: isOverdue(g, now),
      delay: playEntrance ? Math.min(nodeIndex++, 24) * 14 : null,
    });

    const built = groupByProject(projects, goals).map((row) => {
      const dated = row.goals
        .map((g) => ({ g, at: anchorDate(g) }))
        .filter((x): x is { g: DevGoal; at: number } => x.at !== null)
        .sort((a, b) => a.at - b.at);
      const past = dated.filter((x) => x.at < now).map((x) => toNode(x.g));
      const future = dated.filter((x) => x.at >= now).map((x) => toNode(x.g));
      const undated = row.goals.filter((g) => anchorDate(g) === null).map(toNode);
      return { ...row, past, future, undated, nodes: [...past, ...future, ...undated] };
    });
    if (playEntrance) hasEnteredOnceRef.current = true;
    return built;
  }, [allGoals, projects, doneFilter]);

  /**
   * The filter's only JS-side output: which goals the CSS is hiding. Drives the
   * counts and the per-row dashed rule - never the node list itself.
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

  return {
    doneFilter,
    setDoneFilter,
    allGoals,
    rows,
    hiddenIds,
    shownGoals: (allGoals?.length ?? 0) - hiddenIds.size,
    hiddenGoals: hiddenIds.size,
    refresh,
  };
}
