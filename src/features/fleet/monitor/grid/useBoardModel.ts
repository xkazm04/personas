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

/**
 * One rendered column. It inherits `workspaceId` from `TeamGroup` — the first
 * per-team FLAG the column model has carried, and the reason the board can ask
 * a column what KIND of thing it is instead of inferring it from what it holds.
 */
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
  /**
   * Nothing to draw at all: no column holds a row, and the tray is empty.
   *
   * It is NOT `columns.length === 0` any more. A workspace group renders while
   * it is still empty, so on a machine with three workspaces and no personas
   * the column list is never empty — and a board that answered "not empty"
   * there would replace its own empty state with three empty frames and call
   * that a fleet. Emptiness is a question about CONTENT, so it is asked of the
   * rows. For every board that existed before the groups did the two phrasings
   * agree exactly: a team only earned a column by having a card, and a card is
   * a row.
   */
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
  //
  // A WORKSPACE GROUP IS NOW ALWAYS "rendered", so sessions bound to it stop
  // falling through to the tray and land in its own column — including when it
  // holds no personas at all, which is exactly the case this fallback used to
  // catch. That is a strict improvement (the session appears under the group it
  // belongs to rather than in the teamless pile), and it is why `empty` below
  // counts rows rather than columns: a group carrying only sessions has rows.
  const traySessions = useMemo(() => {
    if (filtered) return EMPTY_SESSIONS;
    const rendered = new Set(grouped.teams.map((g) => g.teamId));
    const orphans: FleetSession[] = [];
    for (const [teamId, list] of sessionGroups.byTeam) {
      if (!rendered.has(teamId)) orphans.push(...list);
    }
    return orphans.length > 0 ? [...sessionGroups.ungrouped, ...orphans] : sessionGroups.ungrouped;
  }, [sessionGroups, grouped.teams, filtered]);

  // WORKSPACE GROUPS GO FIRST, AND THE SORT CANNOT LIVE IN THE QUERY.
  // `list_teams` returns `persona_teams.updated_at DESC`, so the board's order
  // is "whichever team was written to most recently" — a rename, a recolour, a
  // member landing anywhere in the fleet reshuffles it. No ORDER BY can pin a
  // row that any later UPDATE is free to move to the front. A partition in the
  // model can, and this one is STABLE on both sides (`filter` preserves order),
  // so hoisting the groups leaves the relative order of every other column
  // exactly as it arrived.
  const ordered = useMemo(() => {
    const groups = grouped.teams.filter((g) => g.workspaceId !== null);
    if (groups.length === 0 || groups.length === grouped.teams.length) return grouped.teams;
    return [...groups, ...grouped.teams.filter((g) => g.workspaceId === null)];
  }, [grouped.teams]);

  const columns = useMemo(
    () => ordered.map((g) => ({
      ...g,
      rows: columnRows(g.cards, filtered ? EMPTY_SESSIONS : (sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS), g.teamName),
    })),
    [ordered, sessionGroups.byTeam, filtered],
  );

  // `every` over an empty list is true, which is the pre-groups behaviour
  // verbatim: no columns + no tray = empty.
  const empty =
    columns.every((c) => c.rows.length === 0)
    && grouped.ungrouped.length === 0
    && traySessions.length === 0;

  return useMemo(
    () => ({ columns, ungrouped: grouped.ungrouped, traySessions, totals, empty, filtered }),
    [columns, grouped.ungrouped, traySessions, totals, empty, filtered],
  );
}
