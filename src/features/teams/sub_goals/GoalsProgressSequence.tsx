/**
 * GoalsProgressSequence — PROTOTYPE VARIANT "Sequence" (filmstrip).
 *
 * Metaphor: each project is a strip of film — its goals are equal-size frames
 * laid strictly in chronological ORDER, not at date positions. The grid is
 * perfectly regular (uniform pitch, wraps into further lines when a project
 * has many goals), which sacrifices date fidelity entirely in exchange for a
 * calm, scannable structure. Two in-row markers keep orientation: a violet
 * "now" rule between past and future frames, and a dashed rule before the
 * dateless tail. Differs from baseline (exact-date scatter) by having no time
 * axis at all — order IS the chronology.
 */
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { GoalAtmosphere } from './goalsTheme';
import {
  GoalSquare,
  ProgressLegend,
  ProgressEmpty,
  useGoalsPortfolio,
  useGoalDrawer,
  groupByProject,
  anchorDate,
  isOverdue,
} from './progressShared';

const LEFT_W = 200;

export function GoalsProgressSequence() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { projects, allGoals } = useGoalsPortfolio();
  const { openGoal, drawer } = useGoalDrawer(allGoals ?? []);

  const { rows, totalGoals } = useMemo(() => {
    const goals = allGoals ?? [];
    const now = Date.now();
    const grouped = groupByProject(projects, goals);
    const rows = grouped.map((row) => {
      const dated = row.goals
        .map((g) => ({ g, at: anchorDate(g) }))
        .filter((x): x is { g: (typeof row.goals)[number]; at: number } => x.at !== null)
        .sort((a, b) => a.at - b.at);
      return {
        ...row,
        past: dated.filter((x) => x.at < now).map((x) => x.g),
        future: dated.filter((x) => x.at >= now).map((x) => x.g),
        undated: row.goals.filter((g) => anchorDate(g) === null),
        now,
      };
    });
    return { rows, totalGoals: goals.length };
  }, [allGoals, projects]);

  if (allGoals === null) return null;
  if (rows.length === 0) return <ProgressEmpty dl={dl} />;

  let nodeIndex = 0;
  const stagger = () => Math.min(nodeIndex++, 24) * 14;

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />
      <ProgressLegend dl={dl} size="lg" />

      <div className="relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden">
        {/* Header — summary + reading direction. Prototype copy; i18n at consolidation. */}
        <div className="flex items-center border-b border-primary/10 bg-secondary/20">
          <div className="shrink-0 px-3 py-2" style={{ width: LEFT_W }}>
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: totalGoals })}
            </span>
          </div>
          <div className="flex-1 flex items-center gap-2 px-1 py-2">
            {/* Prototype copy — i18n at consolidation. */}
            <span className="typo-caption text-foreground uppercase tracking-wider">Past</span>
            <span className="h-px flex-1 bg-gradient-to-r from-primary/20 to-violet-400/40" />
            <span className="px-1.5 py-px rounded-full border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300">
              {dl.progress_today}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-violet-400/40 to-primary/20" />
            <span className="typo-caption text-foreground uppercase tracking-wider">Future</span>
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

            {/* The strip: uniform-pitch frames, chronological order, wrapping. */}
            <div className="flex-1 flex flex-wrap items-center content-center gap-1.5 px-3 py-2.5">
              {row.past.map((g) => (
                <GoalSquare
                  key={g.id}
                  goal={g}
                  overdue={isOverdue(g, row.now)}
                  delay={stagger()}
                  dl={dl}
                  onOpen={openGoal}
                  size="lg"
                />
              ))}
              {/* "Now" rule — everything left is behind us, right is ahead. */}
              <Tooltip content={dl.progress_today}>
                <span aria-hidden="true" className="h-5 w-0.5 rounded-full bg-violet-400/70 mx-0.5" />
              </Tooltip>
              {row.future.map((g) => (
                <GoalSquare
                  key={g.id}
                  goal={g}
                  overdue={false}
                  delay={stagger()}
                  dl={dl}
                  onOpen={openGoal}
                  size="lg"
                />
              ))}
              {row.undated.length > 0 && (
                <>
                  <Tooltip content={dl.progress_no_date}>
                    <span aria-hidden="true" className="h-5 border-l border-dashed border-primary/30 mx-0.5" />
                  </Tooltip>
                  {row.undated.map((g) => (
                    <GoalSquare
                      key={g.id}
                      goal={g}
                      overdue={false}
                      delay={stagger()}
                      dl={dl}
                      onOpen={openGoal}
                      size="lg"
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {drawer}
    </div>
  );
}

export default GoalsProgressSequence;
