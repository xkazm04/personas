// CASES — the layered Activity surface as a SET OF PLACES.
//
// Layer 1 lays the workspace's projects out as tiles and keeps them in a
// stable arrangement, so a project is recognised by where it sits and what
// shape its state bar has rather than by reading its name off a ranked list.
// The bet is the opposite of ATLAS's: an operator who works the same three or
// four projects every day navigates by muscle memory, and a table that
// re-ranks itself every time something changes takes that away.
//
// Opening a project ZOOMS IT: the tile keeps its identity through a shared
// layout animation (`layoutId`) and grows into the full surface, so the
// transition shows you where you came from instead of cutting to a new screen.
// `Esc` and the crumb come back, and the other projects stay one key away.
//
// The decision rail is DOCKED here rather than drawered: a narrow statistic
// column at the right edge that widens in place into the full list. That is
// the owner's own note about removing the permanent panel while keeping the
// counts visible — ATLAS answers it with a layer over the board, CASES with a
// column that grows. Both are honest; they feel different to work.

import { memo, useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { KitHost, Tiles, Tile, UnitStrip, type UnitSegment } from '@/features/shared/components/kit';
import { DeckDispatchBar } from '@/features/agents/quick-answer/triage/deck/DeckDispatchBar';
import { OrchestrationPanel } from '../../orchestration';
import { SessionModals } from '../../board/SessionModals';
import { GridBoard } from '../../board/GridBoard';
import { RailList } from '../../rail/RailList';
import { RailThreadFilter } from '../../rail/RailThreadRow';
import { RailRowView, railRowHeight } from '../../rail/RailRowView';
import type { RailRow } from '../../rail/railModel';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import type { BoardModel } from '../../useBoardModel';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useRailSurface } from '../useRailSurface';
import { useFleetLayers, type ProjectUnit } from './useFleetLayers';
import { WorkspaceCases, FleetTally, WORKSPACE_TABS_PREFIX } from './LayerChrome';

const TONE_OF: Record<SquareState, UnitSegment['tone']> = {
  running: 'primary',
  attention: 'warning',
  failed: 'error',
  idle: 'neutral',
};

function stateSegments(states: Record<SquareState, number>): UnitSegment[] {
  return SQUARE_STATE_ORDER
    .filter((s) => states[s] > 0)
    .map((s) => ({ n: states[s], tone: TONE_OF[s], glyph: s === 'idle' ? 'hollow' : 'solid' }));
}

/** Docked at rest, 13rem; opened, 24rem. A width rather than an overlay, so the
 *  board reflows around it and nothing is ever hidden behind it. */
const DOCK_REST = '13rem';
const DOCK_OPEN = '24rem';

function ActivityCasesImpl(props: ActivitySurfaceProps) {
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
  const toggleDock = useCallback(() => setDockOpen((v) => !v), []);

  // NO ESCAPE BINDING HERE, DELIBERATELY. Climbing out of the project layer on
  // Escape needs the key before `PersonaMonitor`'s own window listener, which
  // closes the whole Monitor — and taking it first means a capture-phase
  // listener, which is how a surface steals a keystroke from the control that
  // was actually focused. The board can hold a LIVE PTY terminal (a fleet
  // session opens one in place), and Escape belongs to whatever is running in
  // it. The way back is the crumb and the back control, both always on screen.
  // Binding this properly means putting the Monitor itself on the app keyboard
  // ladder (`@/lib/keyboard/AppKeyboardProvider`) first, which is a change to
  // production code that a prototype has no business making.

  const openModel = useMemo((): BoardModel | null => {
    const column = layers.open?.column;
    if (!column) return null;
    return { ...surface.model, columns: [column], ungrouped: [], traySessions: [] };
  }, [layers.open, surface.model]);

  const { tab, act, dispatchCtl } = rail;
  const renderRow = useCallback(
    (row: RailRow) => (
      <RailRowView
        row={row}
        selected={row.selectable ? dispatchCtl.selected.has(row.id) : undefined}
        onToggle={row.selectable ? dispatchCtl.toggle : undefined}
        onOpen={row.selectable ? undefined : act.openRow}
        onAccept={row.decidable ? act.acceptRow : undefined}
        onReject={row.decidable ? act.rejectRow : undefined}
      />
    ),
    [dispatchCtl.selected, dispatchCtl.toggle, act.openRow, act.acceptRow, act.rejectRow],
  );

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
        ) : (
          <WorkspaceCases layers={layers} />
        )}
        {openUnit && <span className="typo-title truncate">{openUnit.name}</span>}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {!surface.cold && (
            <FleetTally totals={surface.model.totals} active={surface.filter.state} onPick={surface.pickState} />
          )}
        </div>
      </div>

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
            ) : (
              <motion.div
                key="overview"
                transition={spring}
                className="min-h-0 flex-1 overflow-y-auto"
                {...segmentedTabPanelProps(WORKSPACE_TABS_PREFIX, layers.workspaceId ?? '__all__')}
              >
                <KitHost testId="cases-overview">
                  <div className="p-3">
                    <Tiles label={t.monitor.conv_projects}>
                      {layers.visible.map((u) => (
                        <CaseTile
                          key={u.projectId}
                          unit={u}
                          onOpen={layers.openProject}
                          reducedMotion={surface.reducedMotion}
                        />
                      ))}
                    </Tiles>
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

        {/* THE DOCK. A width, not an overlay: it takes real space and the board
            reflows, so nothing is ever covered by the thing you opened. */}
        <motion.aside
          animate={{ width: dockOpen ? DOCK_OPEN : DOCK_REST }}
          initial={false}
          transition={spring}
          className="flex min-h-0 flex-shrink-0 flex-col border-l border-border bg-foreground/[0.015]"
          aria-label={t.monitor.layers_decisions}
          data-testid="cases-dock"
          data-open={dockOpen || undefined}
        >
          <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-border px-2">
            <span className="min-w-0 flex-1 truncate typo-label text-foreground">{t.monitor.layers_decisions}</span>
            <Tooltip content={dockOpen ? t.common.close : t.monitor.layers_decisions_aria}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleDock}
                aria-expanded={dockOpen}
                aria-label={dockOpen ? t.common.close : t.monitor.layers_decisions_aria}
                data-testid="cases-dock-toggle"
                icon={dockOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              />
            </Tooltip>
          </div>

          {dockOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-shrink-0 p-2">
                <SegmentedTabs
                  size="sm"
                  variant="segment"
                  ariaLabel={t.monitor.grid_rail_tabs_aria}
                  idPrefix="cases-dock"
                  activeTab={tab}
                  onTabChange={rail.setTab}
                  tabs={rail.tabs.map((s) => ({ id: s.id, label: `${s.label} ${s.count}`, testId: `cases-dock-tab-${s.id}` }))}
                />
              </div>
              {tab === 'dispatch' && !rail.simulated && <DeckDispatchBar ctl={dispatchCtl} />}
              {tab === 'messages' && (
                <RailThreadFilter showAll={rail.showAllThreads} onChange={rail.setShowAllThreads} hidden={rail.hiddenThreads} />
              )}
              <div
                className="flex min-h-0 flex-1 flex-col"
                role="tabpanel"
                id={`cases-dock-panel-${tab}`}
                aria-labelledby={`cases-dock-tab-${tab}`}
              >
              <RailList
                key={rail.listKey}
                rows={rail.active.rows}
                heightOf={railRowHeight}
                renderRow={renderRow}
                hasMore={rail.active.hasMore}
                loading={rail.active.loading}
                onEndReached={rail.active.loadMore}
                testId={`cases-dock-list-${tab}`}
                empty={
                  <div className="px-3 py-10">
                    <EmptyIllustration
                      icon={PanelRightOpen}
                      heading={rail.empty[tab].heading}
                      description={rail.empty[tab].description}
                    />
                  </div>
                }
              />
              </div>
            </div>
          ) : (
            /* At rest the dock is three figures. Pressing one opens the list
               already on that tab, so the statistic is also the door. */
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
              {rail.tabs.map((spec) => {
                const Icon = spec.icon;
                return (
                  <Button
                    key={spec.id}
                    variant="ghost"
                    onClick={() => { rail.setTab(spec.id); setDockOpen(true); }}
                    data-testid={`cases-dock-stat-${spec.id}`}
                    className="rounded-input border border-border px-2 py-1.5 text-left"
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="flex items-center gap-1.5 typo-caption text-foreground">
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                        <span className="truncate">{spec.label}</span>
                      </span>
                      <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={spec.count} /></span>
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </motion.aside>
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

const CaseTile = memo(function CaseTile({
  unit, onOpen, reducedMotion,
}: {
  unit: ProjectUnit;
  onOpen: (projectId: string) => void;
  reducedMotion: boolean;
}) {
  const { t, tx } = useTranslation();
  const press = useCallback(() => onOpen(unit.projectId), [onOpen, unit.projectId]);
  const segments = stateSegments(unit.states);

  return (
    <motion.div
      layoutId={reducedMotion ? undefined : `case:${unit.projectId}`}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
      className="contents"
    >
      <Tile
        span={3}
        testId="cases-tile"
        onPress={press}
        title={unit.name}
        count={unit.needsYou > 0 ? <span className="text-status-warning"><Numeric value={unit.needsYou} /></span> : undefined}
        mark={{
          tone: unit.states.failed > 0 ? 'error' : unit.needsYou > 0 ? 'warning' : unit.states.running > 0 ? 'primary' : 'neutral',
          glyph: unit.states.running > 0 ? 'live' : 'solid',
          label: unit.needsYou > 0 ? t.monitor.columns_needs_attention : t.monitor.columns_all_clear,
        }}
        meta={
          <span className="flex items-center gap-2">
            <span>{tx(unit.personas === 1 ? t.monitor.layers_persona_count_one : t.monitor.layers_persona_count_other, { count: unit.personas })}</span>
            {unit.sessions > 0 && <span>{tx(unit.sessions === 1 ? t.monitor.layers_session_count_one : t.monitor.layers_session_count_other, { count: unit.sessions })}</span>}
          </span>
        }
      >
        {segments.length > 0 && (
          <UnitStrip
            segments={segments}
            size="m"
            rows={2}
            label={tx(t.monitor.layers_open_aria, { project: unit.name })}
          />
        )}
      </Tile>
    </motion.div>
  );
});

export const ActivityCases = memo(ActivityCasesImpl);
export default ActivityCases;
