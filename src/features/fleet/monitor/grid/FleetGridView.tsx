// FleetGridView — the "Activity" monitor surface, and the Monitor's baseline.
//
// A control-panel read on the whole fleet: every persona is a state-coloured
// TILE carrying its name, grouped by team into one-per-team columns. Under each
// team's roster a divider separates the personas from the LIVE CLAUDE SESSIONS
// dispatched into that team's projects (cwd → DevProject → team_id). Teamless
// personas, and sessions the board cannot place, live in a tray below.
//
// State + grouping logic is shared (`fleetGridModel`) with the rest of the
// Monitor so a tile's colour always agrees with the other views. Clicking a
// tile selects the persona and opens the Monitor drawer.
//
// THIS FILE IS THE COMPOSITION AND NOTHING ELSE. Each part of the surface owns
// its own module and its own reasoning:
//
//   • `board/GridHeader`   — the title strip, the state key, the simulation
//                            toggle, the cap stepper, the layout switch and the
//                            Orchestration button. Why the key is a row of pills.
//   • `UsageStrip`         — the subscription's five plan slots.
//   • `board/GridBoard`    — the columns, the tray, the empty and ghost states,
//                            and the two tile kinds. Why they differ in shape.
//   • `board/queue/`       — the two queue layouts over the same fleet (runway,
//                            lanes) and `QueueBoard`, which switches between
//                            them and the classic board. The dispatch queue's
//                            verbs live there too.
//   • `board/node/`        — the ONE node every board paints (`FleetNode`) and
//                            its three prototype styles, threaded to every
//                            board through `NodeContext`.
//   • `board/TeamColumn`   — one column; its header IS the rail's scope control.
//   • `board/RailSlot`     — the rail's footprint and its lazy chunk.
//   • `board/SessionModals`— terminal + recap, mounted on click only.
//   • `useBoardModel`      — grouping, tallies, per-column rows.
//   • `useRailScope`       — what a column header can honestly match a feed on.
//   • `useFocusFlash`      — Athena's pointer at a node.
//   • `useStagedMount`     — chrome in frame one, tiles in two, rail in three.
//   • `simulation/`        — the mock fleet, in test builds only.
//
// THE COLD OPEN IS STAGED. `useStagedMount` paints the chrome in frame one
// (header, usage strip, column headers, geometry-matched ghost rows, an empty
// rail of the persisted width), the tiles in frame two, the rail in frame
// three — once per app session, since every later mount is warm and would only
// be slowed by it. A Monitor that opens before the roster exists gets the same
// chrome over `BoardGhost` rather than a header-only skeleton in its place.

import { memo, useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useReducedMotion } from 'framer-motion';
import { lazyRetry } from '@/lib/lazyRetry';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { useSystemStore } from '@/stores/systemStore';
import type { DrawerSection, PersonaCardModel } from '../monitorModel';
import type { FeedTeam } from '../channels/types';
import { UsageStripFallback } from './UsageStripShell';
import { FINAL_STAGE, useStagedMount } from './useStagedMount';
import { useChannelBubbles } from './useChannelBubbles';
import { useFleetSessions } from './useFleetSessions';
import { useBoardModel } from './useBoardModel';
import { useRailScope } from './useRailScope';
import { useFocusFlash } from './useFocusFlash';
import { simQueueActions, useSimulatedBoard, useSimulationEnabled } from './simulation';
import { useSimulatedRail } from './useSimulatedRail';
import { segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { BOARD_TABS_PREFIX, GridHeader } from './board/GridHeader';
import { RailSlot } from './board/RailSlot';
import { SessionModals } from './board/SessionModals';
import { useQueuePoll } from './board/useQueuePoll';
import { QueueBoard } from './board/queue/QueueBoard';
import { useQueueModel } from './board/queue/useQueueModel';
import { useQueueActions } from './board/queue/useQueueActions';
import { useLocalOrder } from './board/queue/useLocalOrder';
import { readBoardVariant, writeBoardVariant, type BoardVariant } from './board/queue/boardVariant';
import { NodeContext, readNodeVariant, writeNodeVariant, type NodeContextValue, type NodeVariant } from './board/node/nodeVariant';
import { meanWaitMs } from './board/queue/queueVerbs';
import { OrchestrationPanel } from './orchestration';

// The usage strip carries a confirm dialog, a toggle and async buttons — a
// chunk of its own, landing into a fallback that already occupies its footprint.
const UsageStrip = lazyRetry(() => import('./UsageStrip'));

/** Stage at which the tiles mount; the rail follows one frame later. */
const TILES_STAGE = 1;

/** Stable empty list for the project lookup while the store is cold. */
const NO_PROJECTS: DevProject[] = [];

interface Props {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  /** Teams whose channels the rail's Messages tab merges. Absent = the tab
   *  renders its empty state rather than subscribing to nothing. */
  feedTeams?: FeedTeam[];
  /** Scope the Monitor's Timeline to one speaker (a Messages row click). */
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  /**
   * The first-ever read has not landed and there is nothing warm to show.
   * The chrome renders regardless; only the board body ghosts — a settled
   * empty state before the first read would be an empty-flash lie.
   */
  isLoading?: boolean;
}

function FleetGridViewImpl({
  cards, personas, teams, selectedPersonaId, onSelect, feedTeams, onOpenSpeaker, isLoading = false,
}: Props) {
  const stage = useStagedMount();
  const reducedMotion = useReducedMotion() ?? false;
  const focusKey = useFocusFlash();

  // Channel bubbles for the personas on this board. The roster set is keyed by
  // the cards' ids, so a roster change re-diffs and nothing else does.
  const personaIds = useMemo(() => new Set(cards.map((c) => c.personaId)), [cards]);
  const liveBubbles = useChannelBubbles(feedTeams, personaIds);
  const liveSessions = useFleetSessions();
  const liveProjects = useSystemStore((st) => st.projects) ?? NO_PROJECTS;
  const liveSessionList = useSystemStore((st) => st.fleetSessions);
  const liveQueue = useSystemStore((st) => st.fleetQueue);

  // THE ONE SEAM. Everything below this line reads `board`, never the props.
  const simulating = useSimulationEnabled();
  const board = useSimulatedBoard(simulating, {
    cards, personas, teams,
    projects: liveProjects,
    sessions: liveSessions,
    sessionList: liveSessionList,
    queue: liveQueue,
    unseen: liveBubbles.unseen,
    isLoading,
  });
  const simulatedRail = useSimulatedRail(simulating);

  // THE QUEUE. The store is event-driven; the board owns the 60 s reconcile
  // poll (only while mounted, and never against the simulated world) and
  // asks for one read on mount so the stepper and the queue boards have a
  // snapshot before the first event arrives.
  const queueRefresh = useSystemStore((st) => st.fleetQueueRefresh);
  useQueuePoll(!simulating);
  useEffect(() => { if (!simulating) void queueRefresh(); }, [simulating, queueRefresh]);

  const [variant, setVariant] = useState<BoardVariant>(readBoardVariant);
  const changeVariant = useCallback((v: BoardVariant) => { setVariant(v); writeBoardVariant(v); }, []);
  const [nodeVariant, setNodeVariant] = useState<NodeVariant>(readNodeVariant);
  const changeNodeVariant = useCallback((v: NodeVariant) => { setNodeVariant(v); writeNodeVariant(v); }, []);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const openOrchestration = useCallback(() => setOrchestrationOpen(true), []);
  const closeOrchestration = useCallback(() => setOrchestrationOpen(false), []);

  const queueModel = useQueueModel(board.sessionList, board.queue, board.personas, board.teams, board.projects);
  const queueActions = useQueueActions(simulating ? simQueueActions : null);
  const queueOrder = useLocalOrder(queueModel.queued, queueActions.reorder);

  // What every node reads, on every board: the style, and the two numbers the
  // meter variant divides by — the mean duration the door's estimates imply
  // and the queue's length. Recomputed only when the queue model does.
  const nodeContext = useMemo<NodeContextValue>(() => ({
    variant: nodeVariant,
    meanDurationMs: meanWaitMs(queueModel.queued, Date.now()),
    queueLength: queueModel.queued.length,
  }), [nodeVariant, queueModel.queued]);

  // Opening a persona is the operator looking at it: its unread mark clears.
  const { acknowledge } = liveBubbles;
  const handleSelect = useCallback(
    (personaId: string, section: DrawerSection) => {
      acknowledge(personaId);
      onSelect(personaId, section);
    },
    [acknowledge, onSelect],
  );

  const model = useBoardModel(board.cards, board.personas, board.teams, board.sessions);
  const { scope, toggleScope, clearScope } = useRailScope(board.projects);

  const [terminal, setTerminal] = useState<FleetSession | null>(null);
  const [recap, setRecap] = useState<FleetSession | null>(null);
  const closeTerminal = useCallback(() => setTerminal(null), []);
  const closeRecap = useCallback(() => setRecap(null), []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border bg-foreground/[0.01] hud-corners hud-bloom">
      <GridHeader
        totals={model.totals}
        showTally={!(board.isLoading && board.cards.length === 0)}
        variant={variant}
        onVariantChange={changeVariant}
        nodeVariant={nodeVariant}
        onNodeVariantChange={changeNodeVariant}
        queueRunning={board.queue?.running ?? queueModel.running.length}
        queueOverAdmitted={board.queue?.overAdmitted ?? 0}
        simulated={simulating}
        onOpenOrchestration={openOrchestration}
      />

      <Suspense fallback={<UsageStripFallback />}>
        <UsageStrip simulated={simulating} />
      </Suspense>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...segmentedTabPanelProps(BOARD_TABS_PREFIX, variant)}>
          <NodeContext.Provider value={nodeContext}>
          <QueueBoard
            variant={variant}
            isLoading={board.isLoading || (!simulating && board.queue === null)}
            classic={{
              model,
              isLoading: board.isLoading,
              staged: stage >= TILES_STAGE,
              reducedMotion,
              focusKey,
              selectedPersonaId,
              onSelect: handleSelect,
              bubbles: liveBubbles.bubbles,
              unseen: board.unseen,
              onOpenSession: setTerminal,
              onRecapSession: setRecap,
              scopedTeamId: scope?.teamId ?? null,
              onToggleScope: toggleScope,
            }}
            queue={{
              model: queueModel,
              order: queueOrder,
              actions: queueActions,
              sessions: board.sessionList,
              teams: board.teams,
              reducedMotion,
              focusKey,
              onOpenSession: setTerminal,
              onRecapSession: setRecap,
            }}
          />
          </NodeContext.Provider>
        </div>

        <RailSlot
          ready={stage >= FINAL_STAGE}
          feedTeams={feedTeams ?? []}
          onOpenSpeaker={onOpenSpeaker}
          filter={scope}
          onClearFilter={clearScope}
          simulated={simulatedRail}
        />
      </div>

      <SessionModals
        terminal={terminal}
        recap={recap}
        onCloseTerminal={closeTerminal}
        onCloseRecap={closeRecap}
      />
      <OrchestrationPanel open={orchestrationOpen} onClose={closeOrchestration} />
    </div>
  );
}

export const FleetGridView = memo(FleetGridViewImpl);
export default FleetGridView;
