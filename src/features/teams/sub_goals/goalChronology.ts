// The deadline sense the Timeline view used to be.
//
// 2026-10-05 the Timeline submodule was retired into the Board. Its real value
// was never the vertical rail - it was this: a goal's target date, bucketed into
// urgency bands, with undated goals kept separate rather than sorted as if they
// were due at the epoch. That logic moved here so the Board can carry it, and
// so it has one home instead of being inlined in a view.
//
// The Board applies it as an ORDER, not as chrome: inside a lane, goals group by
// project and run from most to least urgent. Grouping by project only shows a
// heading when a lane actually holds more than one project - in single-project
// scope the ordering still applies and the heading would be noise.
import type { DevGoal } from '@/lib/bindings/DevGoal';

export type GoalBucket = 'overdue' | 'this_week' | 'this_month' | 'later' | 'undated';

/** Most urgent first; `undated` last, because "no date" is not "due now". */
export const GOAL_BUCKET_ORDER: GoalBucket[] = ['overdue', 'this_week', 'this_month', 'later', 'undated'];

const DAY = 86400000;

/**
 * Which urgency band a target date falls in. An unparseable date is `undated`,
 * not `overdue`: a malformed value is missing information, and treating it as
 * late would invent an alarm the data does not support.
 */
export function goalBucket(targetDate: string | null, now: number): GoalBucket {
  if (!targetDate) return 'undated';
  const t = new Date(targetDate).getTime();
  if (Number.isNaN(t)) return 'undated';
  if (t < now) return 'overdue';
  if (t <= now + 7 * DAY) return 'this_week';
  if (t <= now + 30 * DAY) return 'this_month';
  return 'later';
}

/** The lane accent each band carries, kept from the Timeline's rail. */
export const GOAL_BUCKET_ACCENT: Record<GoalBucket, string> = {
  overdue: 'bg-status-error',
  this_week: 'bg-status-warning',
  this_month: 'bg-status-info',
  later: 'bg-foreground/30',
  undated: 'bg-foreground/20',
};

function dueAt(g: DevGoal): number {
  if (!g.target_date) return Number.POSITIVE_INFINITY;
  const t = new Date(g.target_date).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Group by project, then order each project's goals by deadline.
 *
 * A project's position is its EARLIEST deadline, so the project that needs
 * attention soonest leads; projects whose goals are all undated sort last, and
 * ties break on project id so the order is stable across renders rather than
 * depending on the incoming array's accident of ordering.
 *
 * Within a project: urgency band first (so an overdue goal never sits below a
 * "later" one), then the date itself, then title.
 */
export function orderGoalsByProjectThenDeadline(goals: readonly DevGoal[], now = Date.now()): DevGoal[] {
  const earliestByProject = new Map<string, number>();
  for (const g of goals) {
    const d = dueAt(g);
    const cur = earliestByProject.get(g.project_id);
    if (cur === undefined || d < cur) earliestByProject.set(g.project_id, d);
  }

  const bandOf = (g: DevGoal) => GOAL_BUCKET_ORDER.indexOf(goalBucket(g.target_date, now));

  return [...goals].sort((a, b) => {
    if (a.project_id !== b.project_id) {
      const pa = earliestByProject.get(a.project_id) ?? Number.POSITIVE_INFINITY;
      const pb = earliestByProject.get(b.project_id) ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.project_id.localeCompare(b.project_id);
    }
    const ba = bandOf(a), bb = bandOf(b);
    if (ba !== bb) return ba - bb;
    const da = dueAt(a), db = dueAt(b);
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });
}

/**
 * For an already-ordered lane, the ids that START a new project run - the cards
 * a project heading belongs above. Empty when the lane holds one project, since
 * a heading over every card in a single-project lane says nothing.
 */
export function projectRunHeads(laneGoals: readonly DevGoal[]): Set<string> {
  const distinct = new Set(laneGoals.map((g) => g.project_id));
  if (distinct.size < 2) return new Set();
  const heads = new Set<string>();
  let prev: string | null = null;
  for (const g of laneGoals) {
    if (g.project_id !== prev) heads.add(g.id);
    prev = g.project_id;
  }
  return heads;
}
