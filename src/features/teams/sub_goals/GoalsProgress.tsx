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
 * Two layouts read the same model (`progress/useProgressModel`) and the same
 * canvas (`progress/canvasHost`), behind a dev-only switcher:
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
 * Deleted, the owner's calls: Swimlane (2026-10-06); the Filmstrip tab, Track
 * and Bands (2026-10-08); Cards (2026-10-09), whose milestone cards and
 * re-drawn detail lost features the Notepad already had. The filmstrip
 * survives as Notes' layer 0.
 *
 * The switcher is declared as a named constant rather than an
 * `import.meta.env.DEV` test inside the JSX, and its state is session-scoped:
 * it exists to pick a winner, and a Web Storage call for a throwaway toggle
 * would add a storage site the golden path then has to route somewhere.
 */
import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { PickerScope } from '@/features/plugins/dev-tools/sub_workspaces/usePickerScope';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';

import { GoalAtmosphere } from './goalsTheme';
import { ProgressLegend, ProgressEmpty, ProgressGhost, useGoalDrawer } from './progressShared';
import { ProgressViewProvider, useCanvasHost } from './progress/canvasHost';
import { useProgressModel, type DoneFilter } from './progress/useProgressModel';
import { LedgerCanvas } from './progress/variants/LedgerCanvas';
import { NotesLayers } from './progress/layers/notes/NotesLayers';

const LEFT_W = 200;

/** See the header: a build-flag decision taken at the point of rendering cannot
 *  be enumerated or reviewed; a named constant can be grepped. */
const SHOW_VARIANT_SWITCHER = import.meta.env.DEV;

type ProgressVariant = 'notes' | 'ledger';

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

const VARIANTS: Array<{ id: ProgressVariant; label: string }> = [
  // Notes and Ledger survive; every other layout was deleted rather than kept
  // alive "to decide between" (owner's calls, 2026-10-06 to 2026-10-09).
  { id: 'notes', label: 'Notes' },
  { id: 'ledger', label: 'Ledger' },
];

export function GoalsProgress({ projectScope }: { projectScope?: PickerScope } = {}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const model = useProgressModel(projectScope);
  const [variant, setVariant] = useState<ProgressVariant>('notes');
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
          {SHOW_VARIANT_SWITCHER && (
            <SegmentedTabs<ProgressVariant>
              variant="segment"
              fullWidth={false}
              idPrefix={VARIANT_TABS_ID}
              ariaLabel={dl.goal_view_progress}
              activeTab={variant}
              onTabChange={setVariant}
              tabs={VARIANTS}
            />
          )}
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
