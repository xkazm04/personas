/**
 * GoalsProgressBuckets — PROTOTYPE VARIANT "Buckets" (time-bucket matrix).
 *
 * Metaphor: a matrix. Rows are projects; columns are fixed TIME BUCKETS
 * (Done · Overdue · This week · This month · Later · No date) reusing the
 * Timeline view's bucket vocabulary. Inside each cell, goals sit in a tidy
 * wrapping mini-grid, chronological within the bucket. Column edges give every
 * node an unambiguous home — coarser than dates, far more structured than the
 * baseline scatter. The violet column edge before "This week" is the now
 * boundary. Differs from Sequence by keeping vertical alignment ACROSS
 * projects: scanning a column answers "what's due this week everywhere?".
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { GoalAtmosphere } from './goalsTheme';
import { isComplete } from './goalStatus';
import {
  DAY,
  GoalSquare,
  ProgressLegend,
  ProgressEmpty,
  useGoalsPortfolio,
  useGoalDrawer,
  groupByProject,
  anchorDate,
  isOverdue,
  type DevLifecycleT,
} from './progressShared';

const LEFT_W = 200;

type BucketId = 'done' | 'overdue' | 'this_week' | 'this_month' | 'later' | 'undated';
const BUCKETS: BucketId[] = ['done', 'overdue', 'this_week', 'this_month', 'later', 'undated'];

function bucketLabel(dl: DevLifecycleT, b: BucketId): string {
  switch (b) {
    case 'done': return dl.goal_status_done;
    case 'overdue': return dl.timeline_overdue_group;
    case 'this_week': return dl.timeline_group_this_week;
    case 'this_month': return dl.timeline_group_this_month;
    case 'later': return dl.timeline_group_later;
    case 'undated': return dl.progress_no_date;
  }
}

function bucketFor(g: DevGoal, now: number): BucketId {
  if (isComplete(g.status)) return 'done';
  const at = anchorDate(g);
  if (at === null) return 'undated';
  if (at < now) return 'overdue';
  if (at <= now + 7 * DAY) return 'this_week';
  if (at <= now + 30 * DAY) return 'this_month';
  return 'later';
}

export function GoalsProgressBuckets() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { projects, allGoals } = useGoalsPortfolio();
  const { openGoal, drawer } = useGoalDrawer(allGoals ?? []);

  const { rows, columnCounts, totalGoals, now } = useMemo(() => {
    const goals = allGoals ?? [];
    const now = Date.now();
    const grouped = groupByProject(projects, goals);
    const columnCounts: Record<BucketId, number> = { done: 0, overdue: 0, this_week: 0, this_month: 0, later: 0, undated: 0 };
    const rows = grouped.map((row) => {
      const cells: Record<BucketId, DevGoal[]> = { done: [], overdue: [], this_week: [], this_month: [], later: [], undated: [] };
      for (const g of row.goals) cells[bucketFor(g, now)].push(g);
      for (const b of BUCKETS) {
        cells[b].sort((a, c) => (anchorDate(a) ?? Infinity) - (anchorDate(c) ?? Infinity));
        columnCounts[b] += cells[b].length;
      }
      return { ...row, cells };
    });
    return { rows, columnCounts, totalGoals: goals.length, now };
  }, [allGoals, projects]);

  if (allGoals === null) return null;
  if (rows.length === 0) return <ProgressEmpty dl={dl} />;

  let nodeIndex = 0;
  const stagger = () => Math.min(nodeIndex++, 24) * 14;

  // The "now" boundary sits on the left edge of the This-week column.
  const cellBorder = (b: BucketId) =>
    b === 'this_week' ? 'border-l-2 border-violet-400/40' : 'border-l border-primary/5';

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />
      <ProgressLegend dl={dl} size="lg" />

      <div className="relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden">
        {/* Column header — bucket labels + portfolio-wide counts. */}
        <div
          className="grid border-b border-primary/10 bg-secondary/20"
          style={{ gridTemplateColumns: `${LEFT_W}px repeat(${BUCKETS.length}, 1fr)` }}
        >
          <div className="px-3 py-2">
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: totalGoals })}
            </span>
          </div>
          {BUCKETS.map((b) => (
            <div key={b} className={`px-2 py-2 flex items-center gap-1.5 min-w-0 ${cellBorder(b)}`}>
              <span
                className={`typo-caption uppercase tracking-wider truncate ${
                  b === 'overdue' && columnCounts.overdue > 0 ? 'text-red-400' : 'text-foreground'
                }`}
              >
                {bucketLabel(dl, b)}
              </span>
              {columnCounts[b] > 0 && (
                <span className="typo-caption text-foreground tabular-nums">{columnCounts[b]}</span>
              )}
            </div>
          ))}
        </div>

        {rows.map((row) => (
          <div
            key={row.projectId}
            data-testid={`progress-row-${row.projectId}`}
            className="grid border-b border-primary/5 last:border-b-0 transition-colors hover:bg-primary/[0.03]"
            style={{ gridTemplateColumns: `${LEFT_W}px repeat(${BUCKETS.length}, 1fr)` }}
          >
            <div className="px-3 py-2.5 flex flex-col justify-center gap-0.5 min-w-0">
              <span className="typo-body text-foreground font-medium truncate" title={row.name}>
                {row.name}
              </span>
              <span className="typo-caption text-foreground tabular-nums">
                {tx(dl.progress_row_counts, { active: row.activeCount, done: row.doneCount })}
              </span>
            </div>
            {BUCKETS.map((b) => (
              <div
                key={b}
                className={`flex flex-wrap items-center content-center gap-1.5 px-2 py-2.5 ${cellBorder(b)}`}
              >
                {row.cells[b].map((g) => (
                  <GoalSquare
                    key={g.id}
                    goal={g}
                    overdue={b === 'overdue' || isOverdue(g, now)}
                    delay={stagger()}
                    dl={dl}
                    onOpen={openGoal}
                    size="lg"
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {drawer}
    </div>
  );
}

export default GoalsProgressBuckets;
