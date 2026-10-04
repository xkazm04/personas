// CASES — the layered Activity surface as a SET OF PLACES.
//
// Baseline and the Annunciator both paint one flat layer: every team column of
// every workspace at once, with the decision rail open beside them. At a
// hundred personas across a dozen projects that is a wall of text with nothing
// above it. CASES adds the layer both lack.
//
// LAYER 1 lays the workspace's projects out as tiles in a stable arrangement,
// so a project is recognised by where it sits and what shape its state bar has
// rather than by reading its name off a list that re-ranks itself whenever
// something changes. The bet: an operator works the same three or four projects
// a day and navigates by muscle memory.
//
// LAYER 2 is the REAL BOARD. `GridBoard` is rendered with a model holding the
// opened project's column alone, so the tiles, the drawer, the terminal and the
// recap all behave exactly as they do today and get the whole surface to do it
// in. Opening ZOOMS: the tile keeps its identity through a shared `layoutId`,
// so the transition shows you where you came from instead of cutting.
//
// The decision rail is DOCKED rather than permanently open — see `CasesDock`.
//
// NO ESCAPE BINDING, DELIBERATELY. Climbing out on Escape needs the key before
// `PersonaMonitor`'s own window listener, which means a capture-phase listener
// — and that is how a surface steals a keystroke from the control that was
// actually focused. The board can hold a LIVE PTY terminal, and Escape belongs
// to whatever runs in it. The crumb and the back control are always on screen.
// Binding it properly means putting the Monitor itself on the app keyboard
// ladder (`@/lib/keyboard/AppKeyboardProvider`), which is production code a
// prototype has no business changing.

import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ListOrdered, PanelRightOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { KitHost } from '@/features/shared/components/kit';
import { lazyRetry } from '@/lib/lazyRetry';
import { OrchestrationPanel } from '../../orchestration';
import { AutopilotSwitch } from '../../board/AutopilotSwitch';
import { MaxParallelStepper } from '../../board/MaxParallelStepper';
import { SimulationToggle } from '../../simulation';
import { UsageStripFallback } from '../../UsageStripShell';
import { SessionModals } from '../../board/SessionModals';
import { GridBoard } from '../../board/GridBoard';
import { squareState } from '../../fleetGridModel';
import type { BoardModel } from '../../useBoardModel';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useRailSurface } from '../useRailSurface';
import { useFleetLayers, type FleetLayers, type ProjectUnit } from './useFleetLayers';
import { CaseGrid, FleetTally } from './casesParts';
import { PlateCard, type FollowUpKind, type ProjectCardComponent } from './casesCards';
import { PlateLanes } from './PlateLanes';
import { CasesDock } from './CasesDock';

/** The subscription's plan slots — the overview this variant lost in round 2.
 *  Lazy for the same reason the baseline makes it lazy: it carries a confirm
 *  dialog, a toggle and async buttons that layer 1 does not need to paint. */
const UsageStrip = lazyRetry(() => import('../../UsageStrip'));

const WORKSPACE_TABS_PREFIX = 'layers-workspace';
const VIEW_TABS_PREFIX = 'plate-view';
const ALL = '__all__';

/** The workspace switcher: one case per workspace, in the top-left corner of
 *  the surface, carrying what that workspace owes a human. A dropdown would
 *  scale further; the real fleets here hold a handful of workspaces and a
 *  visible row of cases is one click rather than two. */
function WorkspaceCases({ layers }: { layers: FleetLayers }) {
  const { t } = useTranslation();
  const tabs = [
    { id: ALL, label: t.monitor.layers_all_workspaces, testId: 'layers-workspace-all' },
    ...layers.workspaces.map((w) => ({
      id: w.workspaceId,
      label: w.needsYou > 0 ? `${w.name} · ${w.needsYou}` : w.name,
      testId: `layers-workspace-${w.workspaceId}`,
    })),
  ];
  return (
    <SegmentedTabs
      size="sm"
      variant="segment"
      fullWidth={false}
      ariaLabel={t.monitor.layers_workspace_aria}
      idPrefix={WORKSPACE_TABS_PREFIX}
      activeTab={layers.workspaceId ?? ALL}
      onTabChange={(id) => layers.setWorkspaceId(id === ALL ? null : id)}
      tabs={tabs}
    />
  );
}

export interface CasesProps extends ActivitySurfaceProps {
  /** The project card this round is showing. The layout strategy is settled;
   *  the card is what round 2 is choosing between. */
  Card?: ProjectCardComponent;
}

function ActivityCasesImpl({ Card = PlateCard, ...props }: CasesProps) {
  const { t } = useTranslation();
  const surface = useActivitySurface(props);
  const layers = useFleetLayers(surface);
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const [dockOpen, setDockOpen] = useState(false);
  const { toggleScope, scope } = surface;
  const toggleDock = useCallback(() => setDockOpen((v) => !v), []);
  const openDockTab = useCallback((tab: typeof rail.tab) => {
    rail.setTab(tab);
    setDockOpen(true);
  }, [rail]);

  /**
   * A sigil in a card's corner, pressed. The point of round 3: land in the
   * thing that RESOLVES this, never in another list of it.
   *
   * A warning is a persona that broke, so its resolution is that persona's own
   * drawer opened at its activity — the executions and the trace. A review or
   * an unread report lives in the rail, so the rail is scoped to this project
   * and the dock opens on that tab with the rows ready to decide: `RailRowView`
   * carries the two verdicts inline and opens `RailTriageModal` for the ones
   * that need the full case.
   */
  const resolve = useCallback((unit: ProjectUnit, kind: FollowUpKind) => {
    if (kind === 'warnings') {
      // `squareState`, not `card.execState`: the sigil's number came from
      // `tallyStates`, which derives the board's four states through
      // `pillarStateKey`. Matching on the raw lifecycle field instead found
      // nothing on a card whose count said otherwise — two notions of "failed"
      // for one number, which is the drift the rest of this model avoids.
      const broken = unit.column?.cards.find((c) => squareState(c) === 'failed');
      if (broken) surface.select(broken.personaId, 'activity');
      return;
    }
    if (unit.column && scope?.teamId !== unit.column.teamId) {
      toggleScope(unit.column.teamId, unit.column.teamName, unit.column.cards);
    }
    rail.setTab(kind === 'reviews' ? 'reviews' : 'messages');
    setDockOpen(true);
  }, [rail, scope?.teamId, toggleScope, surface]);

  // Layer 2's board is the real one with a one-column model. Narrowing here
  // rather than in `useBoardModel` keeps the production model untouched: the
  // totals and the filter flag stay exactly what the board computed, and only
  // the column list is cut to the project being read.
  const openModel = useMemo((): BoardModel | null => {
    const column = layers.open?.column;
    if (!column) return null;
    return { ...surface.model, columns: [column], ungrouped: [], traySessions: [] };
  }, [layers.open, surface.model]);

  const spring = surface.reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 400, damping: 32 };
  const openUnit = layers.open;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border bg-foreground/[0.01] hud-corners hud-bloom"
      data-testid="activity-cases"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-foreground/[0.015] px-3">
        {openUnit ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={layers.closeProject}
              data-testid="cases-back"
              className="rounded-interactive border border-border px-2"
            >
              <span className="flex items-center gap-1.5 typo-caption text-foreground">
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                {t.monitor.back_to_grid}
              </span>
            </Button>
            <span className="typo-title truncate">{openUnit.name}</span>
          </>
        ) : (
          <WorkspaceCases layers={layers} />
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* The setup this variant lost in round 2: the attention loop's
              on/off with its pacing verdict, the fleet's cap with running/cap
              beside it, and the read-only look at what the next tick would
              do. Same controls the production header carries, so the two
              surfaces cannot disagree about the machine's settings. */}
          <AutopilotSwitch />
          <MaxParallelStepper
            running={surface.sessionsInFlight}
            overAdmitted={surface.overAdmitted}
            disabled={surface.simulating}
          />
          <Tooltip content={t.monitor.queue_open_orchestration}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={surface.openOrchestration}
              aria-label={t.monitor.queue_open_orchestration}
              data-testid="plate-orchestration"
              icon={<ListOrdered className="h-3.5 w-3.5" />}
              className="rounded-interactive border border-border"
            />
          </Tooltip>
          <SegmentedTabs
            size="sm"
            variant="segment"
            fullWidth={false}
            ariaLabel={t.monitor.board_variant_aria}
            idPrefix={VIEW_TABS_PREFIX}
            activeTab={surface.layout}
            onTabChange={surface.setLayout}
            tabs={[
              { id: 'classic', label: t.monitor.conv_projects, testId: 'plate-view-projects' },
              { id: 'lanes', label: t.monitor.board_variant_lanes, testId: 'plate-view-lanes' },
            ]}
          />
          <SimulationToggle />
          {!surface.cold && (
            <FleetTally totals={surface.model.totals} active={surface.filter.state} onPick={surface.pickState} />
          )}
        </div>
      </div>

      {/* The plans overview, back where the baseline keeps it. */}
      <Suspense fallback={<UsageStripFallback />}>
        <UsageStrip simulated={surface.simulating} />
      </Suspense>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AnimatePresence initial={false} mode="wait">
            {openUnit && openModel ? (
              <motion.div
                key="project"
                layoutId={surface.reducedMotion ? undefined : `case:${openUnit.projectId}`}
                transition={spring}
                className="flex min-h-0 flex-1 flex-col"
              >
                <GridBoard
                  model={openModel}
                  isLoading={surface.board.isLoading}
                  staged
                  reducedMotion={surface.reducedMotion}
                  focusKey={surface.focusKey}
                  selectedPersonaId={props.selectedPersonaId}
                  onSelect={surface.select}
                  bubbles={surface.bubbles}
                  unseen={surface.unseen}
                  onOpenSession={surface.setTerminal}
                  onRecapSession={surface.setRecap}
                  scopedTeamId={surface.scope?.teamId ?? null}
                  onToggleScope={surface.toggleScope}
                  onOpenRemote={props.onOpenRemote}
                />
              </motion.div>
            ) : surface.layout === 'lanes' ? (
              <motion.div
                key="lanes"
                transition={spring}
                className="flex min-h-0 flex-1 flex-col"
                role="tabpanel"
                id={`${VIEW_TABS_PREFIX}-panel-lanes`}
                aria-labelledby={`${VIEW_TABS_PREFIX}-tab-lanes`}
              >
                <PlateLanes
                  model={surface.queueModel}
                  sessions={surface.board.sessionList}
                  onOpenSession={surface.setTerminal}
                />
              </motion.div>
            ) : (
              /* Layer 1, and the panel the workspace strip above controls. */
              <motion.div
                key="overview"
                transition={spring}
                className="min-h-0 flex-1 overflow-y-auto"
                role="tabpanel"
                id={`${WORKSPACE_TABS_PREFIX}-panel-${layers.workspaceId ?? ALL}`}
                aria-labelledby={`${WORKSPACE_TABS_PREFIX}-tab-${layers.workspaceId ?? ALL}`}
              >
                <KitHost testId="cases-overview">
                  <div className="p-3">
                    <CaseGrid
                      units={layers.visible}
                      onOpen={layers.openProject}
                      Card={Card}
                      onResolve={resolve}
                    />
                    {layers.visible.length === 0 && !surface.cold && (
                      <div className="px-3 py-10">
                        <EmptyIllustration
                          icon={PanelRightOpen}
                          heading={t.monitor.layers_empty}
                          description={t.monitor.layers_empty_sub}
                        />
                      </div>
                    )}
                  </div>
                </KitHost>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <CasesDock
          rail={rail}
          open={dockOpen}
          onToggle={toggleDock}
          onOpenTab={openDockTab}
          reducedMotion={surface.reducedMotion}
        />
      </div>

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      {rail.modals}
    </div>
  );
}

export const ActivityCases = memo(ActivityCasesImpl);
export default ActivityCases;
