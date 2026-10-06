/**
 * GoalsProgress - portfolio-level goals overview (Goals v2 L2 "Progress" view).
 *
 * Each project is a row; its goals are equal-size square frames laid in strict
 * chronological ORDER - not at exact date positions. Order carries the
 * chronology (past to future, left to right), which trades date fidelity for a
 * regular, scannable grid where dozens of goals across every project read in
 * one viewsight. Two in-row markers keep orientation: a violet rule at "now"
 * and a dashed rule before the dateless tail. Clicking a frame opens the goal
 * detail drawer; the "+" at the end of a row creates a goal in that project.
 *
 * A done-filter (All / 7D / None) controls how much completed history stays on
 * the row, so finished work does not crowd out the live work.
 *
 * Data lives in `progress/useProgressModel`; the shared node/legend/ghost parts
 * live in `progressShared`. This file is the control row plus the rows.
 */
import { useTranslation } from '@/i18n/useTranslation';
import type { PickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { GoalAtmosphere } from './goalsTheme';
import {
  NODE_PX,
  GoalSquare,
  AddGoalButton,
  ProgressLegend,
  ProgressEmpty,
  ProgressGhost,
  useGoalDrawer,
} from './progressShared';
import { useProgressModel, type DoneFilter } from './progress/useProgressModel';

const LEFT_W = 200;

export function GoalsProgress({ projectScope }: { projectScope?: PickerScope } = {}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const model = useProgressModel(projectScope);
  const { doneFilter, rows, hiddenIds, allGoals } = model;
  const { openGoal, createGoalIn, drawer } = useGoalDrawer(allGoals ?? [], model.refresh);

  // Still fetching - a calm delayed ghost of the rows rather than a blank
  // region or the (settled-only) empty state. See ProgressGhost.
  if (allGoals === null) return <ProgressGhost />;
  if (rows.length === 0) return <ProgressEmpty dl={dl} />;

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
            onTabChange={model.setDoneFilter}
            tabs={[
              { id: 'all', label: dl.progress_filter_all },
              { id: 'recent', label: dl.progress_filter_recent },
              { id: 'none', label: dl.progress_filter_none },
            ]}
          />
        </div>
      </div>

      {/* The strip owns the filter: nodes carry static group-data hide-rules,
          so flipping this attribute is a style recalc - no node re-renders,
          no remounts. */}
      <div
        data-done-filter={doneFilter}
        className="group/strip relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden"
      >
        {/* Header - summary + the row's reading direction. */}
        <div className="flex items-center border-b border-primary/10 bg-secondary/20">
          <div className="shrink-0 px-3 py-2" style={{ width: LEFT_W }}>
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_summary, { projects: rows.length, goals: model.shownGoals })}
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
            {/* Project name only. The "N active / M done" sub-label used to sit
                under it and was removed 2026-10-06: the squares to its right
                already carry both counts by colour, so it restated the row. */}
            <div
              className="shrink-0 px-3 py-2.5 flex flex-col justify-center min-w-0 border-r border-primary/5"
              style={{ width: LEFT_W }}
            >
              <span className="typo-body text-foreground truncate" title={row.name}>
                {row.name}
              </span>
            </div>

            {/* The strip: uniform-pitch frames in chronological order, wrapping. */}
            <div
              className="flex-1 flex flex-wrap items-center content-center gap-1.5 px-3 py-2.5"
              style={{ minHeight: NODE_PX + 20 }}
            >
              {row.past.map((n) => (
                <GoalSquare key={n.goal.id} goal={n.goal} overdue={n.overdue} delay={n.delay} dl={dl} onOpen={openGoal} />
              ))}
              {/* "Now" rule - everything left is behind us, right is ahead. */}
              <Tooltip content={dl.progress_today}>
                <span aria-hidden="true" className="w-0.5 rounded-full bg-violet-400/70 mx-0.5" style={{ height: NODE_PX }} />
              </Tooltip>
              {row.future.map((n) => (
                <GoalSquare key={n.goal.id} goal={n.goal} overdue={n.overdue} delay={n.delay} dl={dl} onOpen={openGoal} />
              ))}
              {/* The dashed rule only earns its place when a dateless goal is
                  actually visible - but the nodes themselves stay mounted so a
                  filter flip never remounts them. */}
              {row.undated.some((n) => !hiddenIds.has(n.goal.id)) && (
                <Tooltip content={dl.progress_no_date}>
                  <span aria-hidden="true" className="border-l border-dashed border-primary/30 mx-0.5" style={{ height: NODE_PX }} />
                </Tooltip>
              )}
              {row.undated.map((n) => (
                <GoalSquare key={n.goal.id} goal={n.goal} overdue={n.overdue} delay={n.delay} dl={dl} onOpen={openGoal} />
              ))}

              {/* Tail: the next empty frame - authors a goal in THIS project. */}
              <AddGoalButton projectName={row.name} label={dl.goal_new_title} onClick={() => createGoalIn(row.projectId)} />
            </div>
          </div>
        ))}

        {/* Honest footer: the filter hides goals; say how many. */}
        {model.hiddenGoals > 0 && (
          <div className="px-3 py-1.5 border-t border-primary/5 bg-secondary/10 text-right">
            <span className="typo-caption text-foreground tabular-nums">
              {tx(dl.progress_hidden_note, { count: model.hiddenGoals })}
            </span>
          </div>
        )}
      </div>

      {drawer}
    </div>
  );
}

export default GoalsProgress;
