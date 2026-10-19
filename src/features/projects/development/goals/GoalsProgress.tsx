/**
 * GoalsProgress - portfolio-level goals overview (Goals v2 L2 "Progress" view).
 *
 * Every project is a row and every goal a frame on it, and the row is a CANVAS:
 * right-click it to create a milestone or a goal, right-click a frame to move
 * that goal between milestones, drag a frame onto a milestone to bind it.
 * Milestones are the real `dev_milestones` cuts the Ship tab works with - a
 * goal binds as a member row of kind 'goal' - so nothing here is a second,
 * parallel idea of what a milestone is. The write path is `progress/milestoneOps`
 * and nothing else in the module calls the milestone API.
 *
 * Two layouts read the same model (`shared/useProgressModel`) and the same
 * canvas (`shared/canvasHost`), behind a Notes | Ledger switch that is always
 * visible. The choice lives in the system store (`goalsView`), so it survives
 * leaving and re-entering Goals and is shared with deep links:
 *
 *   NOTES      the default, three layers deep (spark goals-layers): the
 *              filmstrip across every project as layer 0; the Notepad's own
 *              QuestRoom for one project, banded by milestone (each cut's brief
 *              card beside its goals), as layer 1; the Notepad's editor
 *              (NotePlanPane for a brief) as layer 2. Ported, not re-drawn, so
 *              everything the Notepad does comes along.
 *   LEDGER     one dense `UnifiedTable` row per goal grouped by project, the cut
 *              as a sortable column. Best for working the backlog; shows you
 *              rows rather than shape.
 *
 * This is the only Goals surface: the Board (kanban) was retired in the Goals
 * consolidation. Earlier layouts were deleted, the owner's calls: Swimlane
 * (2026-10-06); the Filmstrip tab, Track and Bands (2026-10-08); Cards
 * (2026-10-09). The filmstrip survives as Notes' layer 0.
 *
 * The switch selects among mutually exclusive regions, so it declares the
 * relationship: a fixed `idPrefix` plus `segmentedTabPanelProps` on the region
 * below makes the strip's `aria-controls` resolve to a real `role="tabpanel"`.
 */
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { GoalsView } from '@/lib/types/types';
import type { PickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';

import { GoalAtmosphere } from './goalsTheme';
import { ProgressLegend, ProgressEmpty, ProgressGhost, useGoalDrawer } from './progressShared';
import { ProgressViewProvider, useCanvasHost } from './shared/canvasHost';
import { useProgressModel, type DoneFilter } from './shared/useProgressModel';
import { LedgerCanvas } from './ledger/LedgerCanvas';
import { NotesLayers } from './notes/NotesLayers';

const LEFT_W = 200;

/**
 * The switcher really does select among mutually exclusive regions, so it
 * declares the relationship instead of only drawing it: a fixed `idPrefix` plus
 * `segmentedTabPanelProps` on the region below means the strip's
 * `aria-controls` resolves to a real `role="tabpanel"`. Measured in the census
 * (`tabstrip-with-no-declared-panel`): across 21 SegmentedTabs sites, the
 * helper that closes this loop had ZERO consumers and every emitted
 * `aria-controls` was dangling.
 */
const VARIANT_TABS_ID = 'goals-progress-variant';

export function GoalsProgress({ projectScope }: { projectScope?: PickerScope } = {}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const model = useProgressModel(projectScope);
  const variant = useSystemStore((st) => st.goalsView);
  const setVariant = useSystemStore((st) => st.setGoalsView);
  const variants: Array<{ id: GoalsView; label: string }> = [
    { id: 'notes', label: dl.goal_view_notes },
    { id: 'ledger', label: dl.goal_view_ledger },
  ];
  const { openGoal, createGoalIn, drawer } = useGoalDrawer(model.allGoals ?? [], model.refresh);

  const projectIds = useMemo(() => model.rows.map((r) => r.projectId), [model.rows]);
  const projectNames = useMemo(
    () => new Map(model.rows.map((r) => [r.projectId, r.name])),
    [model.rows],
  );
  const { host: canvas, overlays } = useCanvasHost({ projectIds, projectNames, createGoalIn });
  const view = useMemo(
    () => ({ model, canvas, openGoal, createGoalIn, dl }),
    [model, canvas, openGoal, createGoalIn, dl],
  );

  // A refused first read is a failure with a retry, never an endless ghost.
  if (model.allGoals === null && model.failed) {
    return (
      <InlineErrorBanner severity="warning" message={t.common.source_unreachable} onRetry={model.refresh} />
    );
  }
  // Still fetching - a calm delayed ghost of the rows rather than a blank
  // region or the (settled-only) empty state. See ProgressGhost.
  if (model.allGoals === null) return <ProgressGhost />;
  if (model.rows.length === 0) return <ProgressEmpty dl={dl} />;

  return (
    <div className="relative pb-6" data-testid="goals-progress">
      <GoalAtmosphere />

      {/* Control row: status key (left) + how much done-history to carry (right). */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <ProgressLegend dl={dl} />
        <div className="flex items-center gap-3">
          <SegmentedTabs<GoalsView>
            variant="segment"
            fullWidth={false}
            idPrefix={VARIANT_TABS_ID}
            ariaLabel={dl.goal_view_progress}
            activeTab={variant}
            onTabChange={setVariant}
            tabs={variants}
          />
          <div className="flex items-center gap-2">
            <span className="typo-caption text-foreground uppercase tracking-wider">
              {dl.goal_status_done}
            </span>
            <SegmentedTabs<DoneFilter>
              variant="segment"
              fullWidth={false}
              ariaLabel={dl.progress_filter_done_aria}
              activeTab={model.doneFilter}
              onTabChange={model.setDoneFilter}
              tabs={[
                { id: 'all', label: dl.progress_filter_all },
                { id: 'recent', label: dl.progress_filter_recent },
                { id: 'none', label: dl.progress_filter_none },
              ]}
            />
          </div>
        </div>
      </div>

      {/* The strip owns the filter: frames carry static group-data hide-rules,
          so flipping this attribute is a style recalc - no frame re-renders,
          no remounts. */}
      <div
        data-done-filter={model.doneFilter}
        className="group/strip relative rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 overflow-hidden"
      >
        <ProgressViewProvider value={view}>
          {/* `role` is written out as well as spread. The helper supplies the
              same value, but the census rule that found this gap is a TEXT
              proxy for it (`tabstrip-with-no-declared-panel` looks for the
              literal `role="tabpanel"`), and a surface that satisfies the
              contract while failing the detector teaches the next reader that
              the gate is noise. */}
          <div {...segmentedTabPanelProps(VARIANT_TABS_ID, variant)} role="tabpanel">
            {variant === 'notes' && <NotesLayers leftWidth={LEFT_W} />}
            {variant === 'ledger' && <LedgerCanvas />}
          </div>
        </ProgressViewProvider>

        {overlays}

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
