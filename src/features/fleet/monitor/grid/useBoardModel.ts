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
  totals: Record<SquareState, number>;
  /** Nothing to draw at all: no columns, no tray. */
  empty: boolean;
}

export function useBoardModel(
  cards: PersonaCardModel[],
  personas: Persona[],
  teams: PersonaTeam[],
  sessionGroups: SessionGrouping,
): BoardModel {
  const grouped = useMemo(() => groupFleet(cards, personas, teams), [cards, personas, teams]);
  const totals = useMemo(() => tallyStates(cards), [cards]);

  // Sessions bound to a team that has no rendered column (every one of its
  // personas is missing from the fleet) would otherwise vanish, so they fall
  // back into the tray rather than being silently dropped.
  const traySessions = useMemo(() => {
    const rendered = new Set(grouped.teams.map((g) => g.teamId));
    const orphans: FleetSession[] = [];
    for (const [teamId, list] of sessionGroups.byTeam) {
      if (!rendered.has(teamId)) orphans.push(...list);
    }
    return orphans.length > 0 ? [...sessionGroups.ungrouped, ...orphans] : sessionGroups.ungrouped;
  }, [sessionGroups, grouped.teams]);

  const columns = useMemo(
    () => grouped.teams.map((g) => ({
      ...g,
      rows: columnRows(g.cards, sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS, g.teamName),
    })),
    [grouped.teams, sessionGroups.byTeam],
  );

  const empty =
    grouped.teams.length === 0 && grouped.ungrouped.length === 0 && traySessions.length === 0;

  return useMemo(
    () => ({ columns, ungrouped: grouped.ungrouped, traySessions, totals, empty }),
    [columns, grouped.ungrouped, traySessions, totals, empty],
  );
}
