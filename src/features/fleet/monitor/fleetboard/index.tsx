// Board: the fleet as one full-frame picture (spark board-monitor).
//
// The fifth Monitor destination. Team bays sized by headcount fill the field,
// every persona is a tile sorted into needs / working / resting / off by the
// Monitor's own attention ranking, a needs-you rail sits on the right, and
// thin strips above and below carry the totals. A bay click zooms the team; a
// tile click opens the same MonitorDrawer the Activity board uses.
//
// The props are the WP0 contract and stay frozen. This file only decides
// WHICH fleet the surface draws: the Monitor's live cards, or - in a test
// build with the simulation switched on - the simulation's 100-persona load
// fleet (20 projects x 5, with its 24h hourly rows), substituted at the input
// boundary as the Activity board does it, so every line below runs its real
// code against the fixture. The Board uses the LOAD fleet rather than
// Activity's 60-agent world because a hundred agents is the picture it is
// judged at.

import { memo, useCallback, useMemo } from 'react';
import type { DrawerSection, PersonaCardModel, ProcessEntry } from '../monitorModel';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { simLoadFleet, useSimulationEnabled } from '../grid/simulation';
import { BoardSurface, type BoardSurfaceProps } from './BoardSurface';
import { useHourlyRuns, type HourlyRuns } from './useBoardData';

export interface BoardViewProps {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  /** Persona-less work (the System band's rows): the Board's bottom strip. */
  systemProcesses: ProcessEntry[];
  /** The Monitor's 1s clock while anything runs (elapsed times). */
  now: number;
  selectedPersonaId: string | null;
  /** Opens the Monitor's drawer on a persona. */
  onSelect: (personaId: string, section: DrawerSection) => void;
  /** First cold open with no cards yet: paint ghosts under the chrome. */
  isLoading: boolean;
}

type SourceProps = Omit<BoardSurfaceProps, 'simulating' | 'hourly'>;

/** Mounted only while the simulation is on, so a real fleet never builds the fixture. */
function SimulatedBoard(props: SourceProps) {
  const fleet = simLoadFleet();
  const hourly = useMemo<HourlyRuns>(() => new Map(fleet.hourly.map((r) => [r.personaId, r.buckets])), [fleet]);
  return (
    <BoardSurface
      {...props}
      cards={fleet.cards}
      personas={fleet.roster.personas}
      teams={fleet.roster.teams}
      isLoading={false}
      simulating
      hourly={hourly}
    />
  );
}

function LiveBoard(props: SourceProps) {
  const hourly = useHourlyRuns(true);
  return <BoardSurface {...props} simulating={false} hourly={hourly} />;
}

export const BoardView = memo(function BoardView(props: BoardViewProps) {
  const simulating = useSimulationEnabled();
  // WP3 SEAM: the team zoom (L1). The nameplate of every bay calls this with
  // the bay's team id (or TEAMLESS_BAY); WP3 turns it into the zoomed view and
  // a level of the Monitor's Escape chain.
  const onZoomTeam = useCallback((_teamId: string) => undefined, []);
  return simulating
    ? <SimulatedBoard {...props} onZoomTeam={onZoomTeam} />
    : <LiveBoard {...props} onZoomTeam={onZoomTeam} />;
});

export default BoardView;
