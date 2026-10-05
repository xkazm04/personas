// boardModel — the fleet as the Board draws it: bays of pile-ordered cards,
// the needs-you queue, and the totals the strips print. Pure; no JSX, no i18n.
//
// Grouping is the Activity board's own `groupFleet` (team by `home_team_id`,
// workspace groups, the teamless tray), so a persona sits in the same bay in
// both views. The Board then drops what has no member (an empty workspace
// group is an invitation on Activity, but on a full-frame picture it is an
// empty band), orders every bay by pile, and the bays by headcount.

import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../monitorModel';
import { actionWeight, groupFleet, tallyStates } from '../grid/fleetGridModel';
import type { BoardModel } from '../grid/useBoardModel';
import { countPiles, orderByPile, pileOf, urgency, type PileCounts } from './piles';

/** The tray's bay id: personas with no home team. */
export const TEAMLESS_BAY = '__teamless';

export interface Bay {
  /** The team id, or {@link TEAMLESS_BAY}. */
  id: string;
  /** Team name; empty for the tray (the view prints its translated label). */
  name: string;
  /** Team colour (identity data, never a status); null for the tray. */
  color: string | null;
  icon: string | null;
  kind: 'team' | 'workspace' | 'teamless';
  /** Pile-ordered: needs (most urgent first) > working > resting > off. */
  cards: PersonaCardModel[];
  counts: PileCounts;
}

export interface BoardShape {
  bays: Bay[];
  /** Fleet-wide pile totals (the top strip). */
  totals: PileCounts;
  /** Every persona that needs you, most urgent first (the rail). */
  queue: PersonaCardModel[];
  /** Persona id -> its bay, for the hover card and the rail. */
  bayOf: Map<string, Bay>;
  runsToday: number;
}

export function buildBoard(cards: PersonaCardModel[], personas: Persona[], teams: PersonaTeam[]): BoardShape {
  const grouped = groupFleet(cards, personas, teams);
  const icons = new Map(teams.map((tm) => [tm.id, tm.icon]));
  const bays: Bay[] = grouped.teams
    .filter((g) => g.cards.length > 0)
    .map((g) => ({
      id: g.teamId,
      name: g.teamName,
      color: g.teamColor,
      icon: icons.get(g.teamId) ?? null,
      kind: g.workspaceId === null ? 'team' : 'workspace',
      cards: orderByPile(g.cards),
      counts: countPiles(g.cards),
    }));
  if (grouped.ungrouped.length > 0) {
    bays.push({
      id: TEAMLESS_BAY, name: '', color: null, icon: null, kind: 'teamless',
      cards: orderByPile(grouped.ungrouped), counts: countPiles(grouped.ungrouped),
    });
  }

  // Largest first, roster order on ties: the order the layout packs in, so
  // the bay list, the field and the attention walk all read the same way.
  bays.sort((a, b) => b.cards.length - a.cards.length);

  const bayOf = new Map<string, Bay>();
  for (const bay of bays) for (const c of bay.cards) bayOf.set(c.personaId, bay);

  // The rail: fleet-wide, most urgent reason first, then the heaviest, then
  // the board's own reading order (bay, then tile) so ties match the field.
  const order = new Map<string, number>();
  let k = 0;
  for (const bay of bays) for (const c of bay.cards) order.set(c.personaId, k++);
  const queue = cards
    .filter((c) => pileOf(c) === 'needs')
    .sort((a, b) => urgency(a) - urgency(b)
      || actionWeight(b) - actionWeight(a)
      || (order.get(a.personaId) ?? k) - (order.get(b.personaId) ?? k));

  return {
    bays,
    totals: countPiles(cards),
    queue,
    bayOf,
    runsToday: cards.reduce((s, c) => s + c.runsToday, 0),
  };
}

/** The board narrowed to one team (the zoom, L1), or the fleet when `bayId` names no bay. */
export interface ZoomedBoard extends BoardShape {
  /** The zoomed bay; null at fleet level - including when the team has left the fleet. */
  zoomed: Bay | null;
}

/**
 * Derived, never stored: a zoom on a team that is gone (a scale switch, the
 * simulation toggled, the team emptied) simply reads as the fleet.
 */
export function zoomBoard(board: BoardShape, bayId: string | null): ZoomedBoard {
  const bay = bayId ? board.bays.find((b) => b.id === bayId) ?? null : null;
  if (!bay) return { ...board, zoomed: null };
  return {
    ...board,
    bays: [bay],
    totals: bay.counts,
    queue: board.queue.filter((c) => board.bayOf.get(c.personaId) === bay),
    runsToday: bay.cards.reduce((s, c) => s + c.runsToday, 0),
    zoomed: bay,
  };
}

/**
 * The shape `useAttentionCursor` walks: one column per bay in the Board's
 * reading order. Its predicate is `actionWeight > 0` - exactly the needs pile -
 * so `n` / `j` / `k` visit the needs tiles bay by bay, most urgent first.
 */
export function attentionModel(bays: readonly Bay[], cards: PersonaCardModel[]): BoardModel {
  return {
    columns: bays.map((bay) => ({
      teamId: bay.id,
      teamName: bay.name,
      teamColor: bay.color ?? '',
      workspaceId: null,
      cards: bay.cards,
      rows: [],
      contestId: null,
      contestProjectId: null,
    })),
    ungrouped: [],
    traySessions: [],
    totals: tallyStates(cards),
    empty: bays.length === 0,
    filtered: false,
  };
}
