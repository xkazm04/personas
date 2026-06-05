/**
 * GoalsTimeline — the active project's goals on a time axis (Goals v2 L2
 * "Timeline" tab). Ongoing goals are bucketed by target window (Overdue → This
 * week → This month → Later → No date) on a vertical rail; each row shows the
 * relative due date, status, and progress, and opens the goal on click. Done
 * goals drop off the timeline (no urgency left).
 */
import { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { GoalStatusBadge } from './GoalStatusBadge';
import { isOngoing, goalStatusMeta } from './goalStatus';
import { GoalAtmosphere, SectionLabel } from './goalsTheme';

type Bucket = 'overdue' | 'this_week' | 'this_month' | 'later' | 'undated';
const BUCKET_ORDER: Bucket[] = ['overdue', 'this_week', 'this_month', 'later', 'undated'];

function bucketFor(targetDate: string | null, now: number): Bucket {
  if (!targetDate) return 'undated';
  const t = new Date(targetDate).getTime();
  if (Number.isNaN(t)) return 'undated';
  const day = 86400000;
  if (t < now) return 'overdue';
  if (t <= now + 7 * day) return 'this_week';
  if (t <= now + 30 * day) return 'this_month';
  return 'later';
}

const BUCKET_ACCENT: Record<Bucket, string> = {
  overdue: 'bg-red-400',
  this_week: 'bg-amber-400',
  this_month: 'bg-blue-400',
  later: 'bg-foreground/30',
  undated: 'bg-foreground/20',
};

export function GoalsTimeline() {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const goals = useSystemStore((s) => s.goals);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);

  const labels: Record<Bucket, string> = {
    overdue: dl.timeline_overdue_group,
    this_week: dl.timeline_group_this_week,
    this_month: dl.timeline_group_this_month,
    later: dl.timeline_group_later,
    undated: dl.timeline_undated_group,
  };

  // Ongoing goals only, bucketed + sorted by target date within each bucket.
  const grouped = useMemo(() => {
    const now = Date.now();
    const buckets: Record<Bucket, DevGoal[]> = { overdue: [], this_week: [], this_month: [], later: [], undated: [] };
    for (const g of goals) {
      if (!isOngoing(g.status)) continue;
      buckets[bucketFor(g.target_date, now)].push(g);
    }
    for (const b of BUCKET_ORDER) {
      buckets[b].sort((a, c) => (a.target_date ?? '').localeCompare(c.target_date ?? ''));
    }
    return buckets;
  }, [goals]);

  const openGoal = (goalId: string) => {
    setPendingGoalSpotlightId(goalId);
    setGoalsTab('board');
  };

  const dated = BUCKET_ORDER.filter((b) => b !== 'undated').reduce((n, b) => n + grouped[b].length, 0);
  if (dated === 0 && grouped.undated.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center py-16 text-center">
        <GoalAtmosphere />
        <CalendarClock className="w-10 h-10 text-foreground mb-3" />
        <h3 className="typo-section-title text-foreground">{dl.timeline_no_dated}</h3>
        <p className="typo-body text-foreground mt-1 max-w-md">{dl.timeline_no_dated_sub}</p>
      </div>
    );
  }

  let rowIndex = 0;
  return (
    <div className="relative space-y-5 pb-6">
      <GoalAtmosphere />
      {BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((b) => (
        <div key={b}>
          <div className="mb-2">
            <SectionLabel accent={BUCKET_ACCENT[b]} count={grouped[b].length}>{labels[b]}</SectionLabel>
          </div>
          {/* Rail */}
          <ul className="relative ml-1 border-l border-primary/10 space-y-1.5 pl-4">
            {grouped[b].map((g) => {
              const delay = Math.min(rowIndex++, 14) * 30;
              return (
              <li key={g.id} className="relative">
                <span
                  className="absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full border-2 border-background"
                  style={{ backgroundColor: goalStatusMeta(g.status).map.fill, boxShadow: `0 0 8px -1px ${goalStatusMeta(g.status).map.glow}` }}
                />
                <button
                  type="button"
                  onClick={() => openGoal(g.id)}
                  style={{ animationDelay: `${delay}ms` }}
                  className="animate-fade-slide-in w-full text-left rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 px-3 py-2 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25 motion-reduce:transform-none focus-ring"
                >
                  <div className="flex items-center gap-2">
                    <span className="typo-body text-foreground truncate flex-1">{g.title}</span>
                    <GoalStatusBadge status={g.status} />
                    {g.target_date && (
                      <span className="typo-caption text-foreground tabular-nums shrink-0">
                        <RelativeTime timestamp={g.target_date} />
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary/50" style={{ width: `${g.progress}%` }} />
                    </div>
                    <span className="typo-caption text-foreground tabular-nums shrink-0">{g.progress}%</span>
                  </div>
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
