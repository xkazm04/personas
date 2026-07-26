/**
 * GoalsTimeline — the active project's goals on a time axis (Goals v2 L2
 * "Timeline" tab). Ongoing goals are bucketed by target window (Overdue → This
 * week → This month → Later → No date) on a vertical rail; each row shows the
 * relative due date, status, and progress, and opens the goal on click. Done
 * goals drop off the timeline (no urgency left).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { GoalStatusBadge } from './GoalStatusBadge';
import { isOngoing, goalStatusMeta } from './goalStatus';
import { GoalAtmosphere, SectionLabel, GoalProjectBadge } from './goalsTheme';
import { GoalDetailDrawer } from './GoalDetailDrawer';
import { GoalEditorModal } from './GoalEditorModal';

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * fresh bucket set lands (35ms stagger via RevealItem, id-guarded so polling,
 * refresh, and scrolling never replay it). Rows beyond this render plainly.
 */
const CASCADE_ROWS = 14;

// Lazy so its ~12KB of traced path data stays out of the eager entry chunk (this file
// is pulled in by two separate lazy chunks — see GoalsEmptyGlyph).
const GoalsEmptyGlyph = lazy(() => import('./GoalsEmptyGlyph'));

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

export function GoalsTimeline({ showProject = false, compact = false, allProjects = false }: { showProject?: boolean; compact?: boolean; allProjects?: boolean } = {}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const storeGoals = useSystemStore((s) => s.goals);
  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  // Cross-project mode (e.g. the multi-team channel sidebar): show ALL not-done
  // goals across every project, not just the active one — fetched directly so
  // it never depends on a single project being loaded into the store. This is
  // this view's OWN fetch (store-mode's loading gate lives in the page shell),
  // so isFetchingAll gates only the ghost below, never store-mode content.
  const [allGoals, setAllGoals] = useState<DevGoal[] | null>(null);
  const [isFetchingAll, setIsFetchingAll] = useState(allProjects);
  useEffect(() => {
    if (!allProjects) return;
    let cancelled = false;
    setIsFetchingAll(true);
    void fetchProjects?.();
    void devApi.listAllGoals()
      .then((g) => { if (!cancelled) setAllGoals(g); })
      .catch(silentCatch('GoalsTimeline.allGoals'))
      .finally(() => { if (!cancelled) setIsFetchingAll(false); });
    return () => { cancelled = true; };
  }, [allProjects, fetchProjects]);
  const goals = allProjects ? (allGoals ?? []) : storeGoals;

  // Open the goal modal DIRECTLY (was: spotlight id + switch to the Board tab,
  // which round-tripped through GoalConstellation to open the same drawer).
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<DevGoal | null>(null);

  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

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

  const openGoal = (goalId: string) => setDetailGoalId(goalId);

  // One-shot row cascade (docs/design/overview-loading.md law 4): entered ids
  // are remembered per scope, so polling/refetching the same goals never
  // replays it; switching scope (single project <-> all projects) resets and
  // ripples the new set once.
  const revealResetKey = allProjects ? 'all' : (activeProjectId ?? 'none');
  const enter = useRevealTracker(revealResetKey);

  // Empty only when there are NO ongoing goals at all (dated OR undated) — the
  // undated group is first-class, never a reason to show the empty state.
  const ongoingCount = BUCKET_ORDER.reduce((n, b) => n + grouped[b].length, 0);
  if (ongoingCount === 0) {
    // allProjects mode fetches directly (above) — while that fetch is in
    // flight and nothing has landed yet, show a calm delayed ghost of the
    // bucketed rail instead of the "no goals" empty state (which would
    // otherwise flash before the real fetch settles). Store-mode has no
    // fetching signal of its own here — the page shell owns that gate.
    if (allProjects && isFetchingAll) {
      return <GoalsTimelineGhost compact={compact} />;
    }
    return (
      <div className="relative flex flex-col items-center justify-center py-16 text-center">
        <GoalAtmosphere />
        <Suspense fallback={<div className="w-36 h-36 mb-2" />}>
          <GoalsEmptyGlyph />
        </Suspense>
        <h3 className="typo-section-title text-foreground">{dl.timeline_no_dated}</h3>
        <p className="typo-body text-foreground mt-1 max-w-md">{dl.timeline_no_dated_sub}</p>
      </div>
    );
  }

  let cascadeIndex = 0;
  return (
    <div className={`relative ${compact ? 'space-y-3.5 pb-3' : 'space-y-5 pb-6'}`}>
      {!compact && <GoalAtmosphere />}
      {BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((b) => (
        <div key={b}>
          <div className="mb-2">
            <SectionLabel accent={BUCKET_ACCENT[b]} count={grouped[b].length}>{labels[b]}</SectionLabel>
          </div>
          {/* Rail */}
          <ul className="relative ml-1 border-l border-primary/10 space-y-1.5 pl-4">
            {grouped[b].map((g) => {
              const order = cascadeIndex++;
              return (
              <li key={g.id} className="relative">
                <span
                  className="absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full border-2 border-background"
                  style={{ backgroundColor: goalStatusMeta(g.status).map.fill, boxShadow: `0 0 8px -1px ${goalStatusMeta(g.status).map.glow}` }}
                />
                <RevealItem
                  revealId={g.id}
                  order={order}
                  hasEntered={(id) => order >= CASCADE_ROWS || enter.hasEntered(id)}
                  markEntered={enter.markEntered}
                >
                <button
                  type="button"
                  onClick={() => openGoal(g.id)}
                  className="w-full text-left rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 px-3 py-2 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25 motion-reduce:transform-none focus-ring"
                >
                  <div className="flex items-center gap-2">
                    <span className="typo-body text-foreground truncate flex-1">{g.title}</span>
                    {showProject && projectNameById.get(g.project_id) && (
                      <GoalProjectBadge name={projectNameById.get(g.project_id)!} />
                    )}
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
                </RevealItem>
              </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* The goal modal opens here, directly — no Board round-trip. */}
      <GoalDetailDrawer
        isOpen={!!detailGoalId}
        goalId={detailGoalId}
        goalFallback={goals.find((g) => g.id === detailGoalId) ?? null}
        onClose={() => setDetailGoalId(null)}
        onEdit={(g) => { setDetailGoalId(null); setEditGoal(g); }}
      />
      {activeProjectId && (
        <GoalEditorModal
          isOpen={!!editGoal}
          editGoal={editGoal}
          projectId={activeProjectId}
          onClose={() => setEditGoal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalsTimelineGhost — calm placeholder for the ONLY moment allProjects mode's
// own direct fetch (listAllGoals) is in flight and nothing has landed yet.
// Mirrors the real rail's geometry (bucket label bar + rail rows) so the
// ghost-to-content swap moves nothing. Each element is invisible for its
// first ~120ms (animation-delay + fill-mode both) so a fast fetch never
// paints a single ghost — no `animate-pulse`, ever.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_ROW_WIDTHS = ['w-48', 'w-36', 'w-40'];

function GoalsTimelineGhost({ compact }: { compact?: boolean }) {
  return (
    <div className={`relative ${compact ? 'space-y-3.5 pb-3' : 'space-y-5 pb-6'}`} aria-hidden="true">
      {!compact && <GoalAtmosphere />}
      {[0, 1].map((bucket) => (
        <div key={bucket}>
          <div className="mb-2 flex items-center gap-2 animate-fade-in" style={{ animationDelay: '120ms' }}>
            <span className="h-3 w-0.5 rounded-full bg-foreground/20" />
            <span className={`h-2.5 w-20 ${GHOST_BAR}`} />
          </div>
          <ul className="relative ml-1 border-l border-primary/10 space-y-1.5 pl-4">
            {GHOST_ROW_WIDTHS.map((w, i) => {
              const delay = `${140 + (bucket * GHOST_ROW_WIDTHS.length + i) * 35}ms`;
              return (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full border-2 border-background bg-foreground/15" />
                  <div
                    className="w-full rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 px-3 py-2 animate-fade-in"
                    style={{ animationDelay: delay }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-3.5 ${w} ${GHOST_BAR}`} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
