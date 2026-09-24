// useActivitySurface — every piece of state the Activity surface reads, with no
// pixels attached. PROTOTYPE SEAM: it is `FleetGridView`'s wiring lifted out
// verbatim so three design-language variants can paint the same fleet without
// each re-deriving it. At consolidation the winner's composition keeps this
// hook and `FleetGridView` either adopts it or is replaced by the winner.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { useSystemStore } from '@/stores/systemStore';
import type { DrawerSection, PersonaCardModel } from '../../monitorModel';
import type { FeedTeam } from '../../channels/types';
import { useStagedMount } from '../useStagedMount';
import { useChannelBubbles } from '../useChannelBubbles';
import { useFleetSessions } from '../useFleetSessions';
import { useBoardModel } from '../useBoardModel';
import { useRemoteBoard } from '../remote/useRemoteBoard';
import { useAttentionCursor } from '../useAttentionCursor';
import { NO_BOARD_FILTER, type BoardFilter } from '../boardFilter';
import type { SquareState } from '../fleetGridModel';
import { useRailScope } from '../useRailScope';
import { useFocusFlash } from '../useFocusFlash';
import { simQueueActions, useSimulatedBoard, useSimulationEnabled } from '../simulation';
import { useSimulatedRail } from '../useSimulatedRail';
import { useQueuePoll } from '../board/useQueuePoll';
import { useQueueModel } from '../board/queue/useQueueModel';
import { useQueueActions } from '../board/queue/useQueueActions';
import { useLocalOrder } from '../board/queue/useLocalOrder';
import { readBoardVariant, writeBoardVariant, type BoardVariant } from '../board/queue/boardVariant';
import type { NodeContextValue } from '../board/node/nodeContext';
import { meanWaitMs } from '../board/queue/queueVerbs';

const NO_PROJECTS: DevProject[] = [];

export interface ActivitySurfaceProps {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  feedTeams?: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  isLoading?: boolean;
  onOpenRemote?: (jobId: string) => void;
}

export function useActivitySurface({
  cards, personas, teams, onSelect, feedTeams, isLoading = false,
}: ActivitySurfaceProps) {
  const stage = useStagedMount();
  const reducedMotion = useReducedMotion() ?? false;
  const focusKey = useFocusFlash();

  const personaIds = useMemo(() => new Set(cards.map((c) => c.personaId)), [cards]);
  const liveBubbles = useChannelBubbles(feedTeams, personaIds);
  const liveSessions = useFleetSessions();
  const liveProjects = useSystemStore((st) => st.projects) ?? NO_PROJECTS;
  const liveSessionList = useSystemStore((st) => st.fleetSessions);
  const liveQueue = useSystemStore((st) => st.fleetQueue);

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

  const queueRefresh = useSystemStore((st) => st.fleetQueueRefresh);
  useQueuePoll(!simulating);
  useEffect(() => { if (!simulating) void queueRefresh(); }, [simulating, queueRefresh]);

  const [layout, setLayoutState] = useState<BoardVariant>(readBoardVariant);
  const setLayout = useCallback((v: BoardVariant) => { setLayoutState(v); writeBoardVariant(v); }, []);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const openOrchestration = useCallback(() => setOrchestrationOpen(true), []);
  const closeOrchestration = useCallback(() => setOrchestrationOpen(false), []);

  const queueModel = useQueueModel(board.sessionList, board.queue, board.personas, board.teams, board.projects);
  const queueActions = useQueueActions(simulating ? simQueueActions : null);
  const queueOrder = useLocalOrder(queueModel.queued, queueActions.reorder);

  const nodeContext = useMemo<NodeContextValue>(() => ({
    meanDurationMs: meanWaitMs(queueModel.queued, Date.now()),
    queueLength: queueModel.queued.length,
  }), [queueModel.queued]);

  const { acknowledge } = liveBubbles;
  const select = useCallback(
    (personaId: string, section: DrawerSection) => {
      acknowledge(personaId);
      onSelect(personaId, section);
    },
    [acknowledge, onSelect],
  );

  const [filter, setFilter] = useState<BoardFilter>(NO_BOARD_FILTER);
  const pickState = useCallback(
    (state: SquareState) => setFilter((f) => ({ ...f, state: f.state === state ? null : state })),
    [],
  );
  const clearFilter = useCallback(() => setFilter(NO_BOARD_FILTER), []);

  const remote = useRemoteBoard(board.projects, !simulating);
  const model = useBoardModel(board.cards, board.personas, board.teams, board.sessions, filter, remote);
  useAttentionCursor(model, board.cards, select);

  const { scope, toggleScope, clearScope } = useRailScope(board.projects);

  const [terminal, setTerminal] = useState<FleetSession | null>(null);
  const [recap, setRecap] = useState<FleetSession | null>(null);
  const closeTerminal = useCallback(() => setTerminal(null), []);
  const closeRecap = useCallback(() => setRecap(null), []);

  /** "Running" on the tally counts PERSONAS executing a run; the queue counts
   *  Claude SESSIONS holding a slot. Two different nouns — both are exposed so a
   *  variant never prints one under the other's label. */
  const sessionsInFlight = board.queue?.running ?? queueModel.running.length;

  return {
    stage, reducedMotion, focusKey, simulating, board, simulatedRail,
    bubbles: liveBubbles.bubbles, unseen: board.unseen,
    layout, setLayout,
    orchestrationOpen, openOrchestration, closeOrchestration,
    queueModel, queueActions, queueOrder, nodeContext,
    select, filter, pickState, clearFilter,
    model, scope, toggleScope, clearScope,
    terminal, setTerminal, closeTerminal, recap, setRecap, closeRecap,
    sessionsInFlight,
    overAdmitted: board.queue?.overAdmitted ?? 0,
    /** The first read has not landed and nothing warm exists. */
    cold: board.isLoading && board.cards.length === 0,
    queueCold: board.isLoading || (!simulating && board.queue === null),
  };
}

export type ActivitySurface = ReturnType<typeof useActivitySurface>;
