// useBoardModel — the board's shape, derived once per change.
//
// Everything here is a memo over the props and the session registry, and it is
// separated from the view for a reason that outlives tidiness: a state event
// that changes ONE team's sessions must not rebuild the row list of every other
// team. Building the columns here — with each row's height already decided by
// `gridGeometry` — keeps that boundary explicit, and keeps the view a function
// of a model rather than a place where memos accumulate.

import { useMemo } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../monitorModel';
import { groupFleet, tallyStates, type SquareState, type TeamGroup } from './fleetGridModel';
import { filterCards, isBoardFilterActive, NO_BOARD_FILTER, type BoardFilter } from './boardFilter';
import type { SessionGrouping } from './fleetSessionModel';
import { columnRows, type ColumnRow } from './gridGeometry';

/** Stable empty list so a session-less column never rebuilds its rows. */
const EMPTY_SESSIONS: FleetSession[] = [];

export interface BoardColumn extends TeamGroup {
  rows: ColumnRow[];
}

export interface BoardModel {
  columns: BoardColumn[];
  /** Teamless personas — the tray's first half. */
  ungrouped: PersonaCardModel[];
  /** Sessions the board could not place — the tray's second half. */
  traySessions: FleetSession[];
  /**
   * The state key, counted over the WHOLE roster — never over the filtered
   * board. A pill that reads `attention 6` has to keep meaning six whichever
   * way the board is narrowed, or clicking it could not promise six tiles.
   */
  totals: Record<SquareState, number>;
  /** Nothing to draw at all: no columns, no tray. */
  empty: boolean;
  /** The board is narrowed, so `empty` means "nothing matches", not "nobody here". */
  filtered: boolean;
}

export function useBoardModel(
  cards: PersonaCardModel[],
  personas: Persona[],
  teams: PersonaTeam[],
  sessionGroups: SessionGrouping,
  filter: BoardFilter = NO_BOARD_FILTER,
): BoardModel {
  const visible = useMemo(() => filterCards(cards, filter), [cards, filter]);
  const grouped = useMemo(() => groupFleet(visible, personas, teams), [visible, personas, teams]);
  const totals = useMemo(() => tallyStates(cards), [cards]);
  const filtered = isBoardFilterActive(filter);

  // Sessions bound to a team that has no rendered column (every one of its
  // personas is missing from the fleet) would otherwise vanish, so they fall
  // back into the tray rather than being silently dropped.
  //
  // A FILTERED BOARD CARRIES NO SESSIONS AT ALL. Narrowing collapses most
  // columns, and every collapsed column's sessions would land in the tray —
  // turning a queue of six cards into a queue of six cards under a wall of
  // processes. The filter is a question about personas, so when it is on the
  // board answers only about personas.
  const traySessions = useMemo(() => {
    if (filtered) return EMPTY_SESSIONS;
    const rendered = new Set(grouped.teams.map((g) => g.teamId));
    const orphans: FleetSession[] = [];
    for (const [teamId, list] of sessionGroups.byTeam) {
      if (!rendered.has(teamId)) orphans.push(...list);
    }
    return orphans.length > 0 ? [...sessionGroups.ungrouped, ...orphans] : sessionGroups.ungrouped;
  }, [sessionGroups, grouped.teams, filtered]);

  const columns = useMemo(
    () => grouped.teams.map((g) => ({
      ...g,
      rows: columnRows(g.cards, filtered ? EMPTY_SESSIONS : (sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS)),
    })),
    [grouped.teams, sessionGroups.byTeam, filtered],
  );

  const empty =
    grouped.teams.length === 0 && grouped.ungrouped.length === 0 && traySessions.length === 0;

  return useMemo(
    () => ({ columns, ungrouped: grouped.ungrouped, traySessions, totals, empty, filtered }),
    [columns, grouped.ungrouped, traySessions, totals, empty, filtered],
  );
}
