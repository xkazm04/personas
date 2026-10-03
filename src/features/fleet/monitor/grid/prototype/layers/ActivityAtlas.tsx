// ATLAS — the layered Activity surface as a LEDGER.
//
// Layer 1 is one row per project, ranked by what it owes a human, and every
// figure on the row is a door: pressing a project's `attention` count opens
// that project already narrowed to the personas waiting on you. The bet is
// that an operator with a dozen projects is answering "where do I go" and a
// ranked table answers it faster than any arrangement in space — no hunting
// across a board, no scrolling sideways, the first row is the answer.
//
// Layer 2 is the REAL BOARD, narrowed to one project. Not a reimplementation:
// `GridBoard` is rendered with a model holding that project's column alone, so
// the tiles, the session rows, the drawer, the terminal and the recap all work
// exactly as they do today and get the whole surface to do it in.
//
// Different from CASES in mental model: Atlas ranks and you read down a column
// of figures; Cases arranges and you recognise a project by its place and its
// shape. Atlas is the faster surface when the fleet is large and unfamiliar.

import { memo, useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { KitHost, Rows, ListRow, Crumbs, UnitStrip, type UnitSegment } from '@/features/shared/components/kit';
import { segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { OrchestrationPanel } from '../../orchestration';
import { SessionModals } from '../../board/SessionModals';
import { GridBoard } from '../../board/GridBoard';
import { SQUARE_STATE_ORDER, type SquareState } from '../../fleetGridModel';
import type { BoardModel } from '../../useBoardModel';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useRailSurface } from '../useRailSurface';
import { useFleetLayers, type ProjectUnit } from './useFleetLayers';
import { WorkspaceCases, FleetTally, DecisionDock, DecisionLayer, WORKSPACE_TABS_PREFIX } from './LayerChrome';

/** The four states as one proportional strip — the project's shape at a glance,
 *  on the same tones the board paints its tiles with. */
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

function ActivityAtlasImpl(props: ActivitySurfaceProps) {
  const { t, tx } = useTranslation();
  const surface = useActivitySurface(props);
  const layers = useFleetLayers(surface);
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const openDecisions = useCallback(() => setDecisionsOpen(true), []);
  const closeDecisions = useCallback(() => setDecisionsOpen(false), []);

  // Layer 2's board is the real one with a one-column model. Narrowing here
  // rather than in `useBoardModel` keeps the production model untouched: the
  // tray, the totals and the filter flag all stay exactly what the board
  // computed, and only the column list is cut to the project being read.
  const openModel = useMemo((): BoardModel | null => {
    const column = layers.open?.column;
    if (!column) return null;
    return { ...surface.model, columns: [column], ungrouped: [], traySessions: [] };
  }, [layers.open, surface.model]);

  const openUnit = layers.open;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border bg-foreground/[0.01] hud-corners hud-bloom"
      data-testid="activity-atlas"
    >
      {/* One band of chrome: the cases on the left exactly where the owner
          asked for them, the fleet's own tally and the decision dock on the
          right. It does not change between layers — only its crumb does. */}
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-foreground/[0.015] px-3">
        <WorkspaceCases layers={layers} />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {!surface.cold && (
            <FleetTally totals={surface.model.totals} active={surface.filter.state} onPick={surface.pickState} />
          )}
          <DecisionDock rail={rail} open={decisionsOpen} onOpen={openDecisions} />
        </div>
      </div>

      {openUnit && openModel ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
            <Crumbs
              label={t.monitor.layers_overview}
              testId="atlas-crumbs"
              items={[
                { label: t.monitor.conv_projects, onPress: layers.closeProject, testId: 'atlas-crumb-up' },
                { label: openUnit.name },
              ]}
            />
            <span className="ml-auto flex items-center gap-2 typo-caption text-foreground">
              <span>{tx(openUnit.personas === 1 ? t.monitor.layers_persona_count_one : t.monitor.layers_persona_count_other, { count: openUnit.personas })}</span>
              {openUnit.needsYou > 0 && (
                <span className="text-status-warning">
                  {tx(openUnit.needsYou === 1 ? t.monitor.layers_needs_you_count_one : t.monitor.layers_needs_you_count_other, { count: openUnit.needsYou })}
                </span>
              )}
            </span>
          </div>
          {/* The production board, with the whole surface to itself. */}
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
        </div>
      ) : (
        <KitHost testId="atlas-ledger">
          <div
            className="min-h-0 flex-1 overflow-y-auto p-3"
            {...segmentedTabPanelProps(WORKSPACE_TABS_PREFIX, layers.workspaceId ?? '__all__')}
          >
            <Rows
              count={layers.visible.length}
              label={t.monitor.conv_projects}
              loading={surface.cold}
              empty={{ title: t.monitor.layers_empty, hint: t.monitor.layers_empty_sub }}
              /* The board's OWN four-state vocabulary, split exactly as the
                 header pills split it. An earlier pass had one "needs
                 attention" column carrying attention + failed, which read as a
                 third number next to two pills that already name those two
                 states separately. */
              columns={[
                { head: t.monitor.layers_shape, width: '12rem' },
                { head: t.monitor.grid_state_attention, width: '6rem', align: 'end' },
                { head: t.monitor.grid_state_failed, width: '5rem', align: 'end' },
                { head: t.monitor.grid_state_running, width: '6rem', align: 'end' },
                { head: t.monitor.conv_persona_group, width: '6rem', align: 'end' },
              ]}
            >
              {layers.visible.map((u) => (
                <AtlasRow key={u.projectId} unit={u} onOpen={layers.openProject} />
              ))}
            </Rows>
          </div>
        </KitHost>
      )}

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      <DecisionLayer rail={rail} open={decisionsOpen} onClose={closeDecisions} />
      {rail.modals}
    </div>
  );
}

const AtlasRow = memo(function AtlasRow({
  unit, onOpen,
}: {
  unit: ProjectUnit;
  onOpen: (projectId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const press = useCallback(() => onOpen(unit.projectId), [onOpen, unit.projectId]);
  const segments = stateSegments(unit.states);

  return (
    <ListRow
      testId="atlas-row"
      onPress={press}
      name={unit.name}
      mark={{
        tone: unit.states.failed > 0 ? 'error' : unit.needsYou > 0 ? 'warning' : unit.states.running > 0 ? 'primary' : 'neutral',
        glyph: unit.states.running > 0 ? 'live' : 'solid',
        label: unit.needsYou > 0 ? t.monitor.columns_needs_attention : t.monitor.columns_all_clear,
      }}
      meta={unit.sessions > 0 ? tx(unit.sessions === 1 ? t.monitor.layers_session_count_one : t.monitor.layers_session_count_other, { count: unit.sessions }) : undefined}
      cells={[
        segments.length > 0
          ? <UnitStrip segments={segments} size="s" label={tx(t.monitor.layers_open_aria, { project: unit.name })} />
          : null,
        <span className={unit.states.attention > 0 ? 'typo-data text-status-warning tabular-nums' : 'typo-caption text-foreground tabular-nums'}>
          <Numeric value={unit.states.attention} />
        </span>,
        <span className={unit.states.failed > 0 ? 'typo-data text-status-error tabular-nums' : 'typo-caption text-foreground tabular-nums'}>
          <Numeric value={unit.states.failed} />
        </span>,
        <span className="typo-data text-foreground tabular-nums"><Numeric value={unit.states.running} /></span>,
        <span className="typo-caption text-foreground tabular-nums"><Numeric value={unit.personas} /></span>,
      ]}
      time={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={press}
          aria-label={tx(t.monitor.layers_open_aria, { project: unit.name })}
          data-testid="atlas-open"
          icon={<ChevronRight className="h-3.5 w-3.5" />}
        />
      }
    />
  );
});

export const ActivityAtlas = memo(ActivityAtlasImpl);
export default ActivityAtlas;
