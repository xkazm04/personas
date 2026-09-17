// boardFilter — the Activity board's queue predicate.
//
// The claim under test is the one the retired Project-columns view used to
// make and this board stopped making: with the filter on, the tiles the board
// paints are exactly the cards with something pending. The tally is checked in
// the same breath, because a key that counted the filtered board instead of the
// roster would make every pill a different promise depending on what is shown.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../monitorModel';
import type { SessionGrouping } from '../fleetSessionModel';
import { cardPasses, filterCards, isBoardFilterActive, NO_BOARD_FILTER } from '../boardFilter';
import { useBoardModel } from '../useBoardModel';

const ACTIONABLE = { actionableOnly: true, state: null };

const review = (id: string): ManualReviewItem => ({ id, severity: 'warning' } as unknown as ManualReviewItem);
const report = (id: string): PersonaReport => ({ id } as unknown as PersonaReport);
const session = (id: string): FleetSession => ({ id, state: 'running' } as unknown as FleetSession);

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'P', personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    messages: [], processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    // actionWeight falls back to these counts when the arrays are empty.
    reviewCount: 0, messageCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  } as PersonaCardModel;
}

const persona = (id: string, teamId: string | null): Persona =>
  ({ id, home_team_id: teamId } as unknown as Persona);
const team = (id: string): PersonaTeam =>
  ({ id, name: id, color: '#fff' } as unknown as PersonaTeam);

/** Ten cards; three of them have something pending. */
function roster(): PersonaCardModel[] {
  const quiet = Array.from({ length: 7 }, (_, i) => card({ personaId: `q${i}`, personaName: `Quiet ${i}` }));
  return [
    card({ personaId: 'a1', personaName: 'Failed', execState: 'failed' }),
    // `attentionCount` is what the square's state reads; `reviews` is what the
    // queue predicate reads. A real card carries both, so the fixture does too.
    card({
      personaId: 'a2', personaName: 'Review', attentionCount: 1,
      reviews: [review('r')], topReviewSeverity: 'warning',
    }),
    card({ personaId: 'a3', personaName: 'Input', inputRequired: 2 }),
    ...quiet,
  ];
}

const NO_SESSIONS: SessionGrouping = { byTeam: new Map(), ungrouped: [] };

function tiles(model: { columns: { cards: PersonaCardModel[] }[]; ungrouped: PersonaCardModel[] }) {
  return [...model.columns.flatMap((c) => c.cards), ...model.ungrouped];
}

describe('boardFilter', () => {
  it('is inert by default and returns the same array', () => {
    const cards = roster();
    expect(isBoardFilterActive(NO_BOARD_FILTER)).toBe(false);
    expect(filterCards(cards, NO_BOARD_FILTER)).toBe(cards);
  });

  it('keeps exactly the cards with something pending', () => {
    const kept = filterCards(roster(), ACTIONABLE);
    expect(kept.map((c) => c.personaId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('counts an unread report as pending and a running task as not', () => {
    expect(cardPasses(card({ messages: [report('m')] }), ACTIONABLE)).toBe(true);
    // Running is work in flight, not work waiting on the operator.
    expect(cardPasses(card({ execState: 'running', running: 1 }), ACTIONABLE)).toBe(false);
  });
});

describe('useBoardModel under a filter', () => {
  const personas = [
    persona('a1', 't1'), persona('a2', 't1'), persona('a3', 't2'),
    ...Array.from({ length: 7 }, (_, i) => persona(`q${i}`, 't3')),
  ];
  const teams = [team('t1'), team('t2'), team('t3')];

  it('paints three tiles from a ten-card roster', () => {
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, NO_SESSIONS, ACTIONABLE),
    );
    expect(tiles(result.current)).toHaveLength(3);
    expect(result.current.filtered).toBe(true);
  });

  it('collapses the column whose every persona is quiet', () => {
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, NO_SESSIONS, ACTIONABLE),
    );
    expect(result.current.columns.map((c) => c.teamId)).toEqual(['t1', 't2']);
  });

  it('paints the whole roster with the filter off', () => {
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, NO_SESSIONS),
    );
    expect(tiles(result.current)).toHaveLength(10);
    expect(result.current.filtered).toBe(false);
  });

  it('keeps the tally on the whole roster, not on the visible board', () => {
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, NO_SESSIONS, ACTIONABLE),
    );
    // 7 quiet cards are still idle even though the board does not show them.
    expect(result.current.totals.idle).toBe(7);
    expect(result.current.totals.failed).toBe(1);
    expect(result.current.totals.attention).toBe(2);
  });

  // The pill's promise: its number and the board it produces are the same set.
  it.each(['running', 'attention', 'failed', 'idle'] as const)(
    'paints exactly totals.%s tiles when the board is filtered to that state',
    (state) => {
      const { result } = renderHook(
        () => useBoardModel(roster(), personas, teams, NO_SESSIONS, { actionableOnly: false, state }),
      );
      expect(tiles(result.current)).toHaveLength(result.current.totals[state]);
    },
  );

  it('ANDs the two narrowings rather than letting the later one win', () => {
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, NO_SESSIONS, { actionableOnly: true, state: 'idle' }),
    );
    // Every idle card in the fixture is quiet, so the intersection is empty —
    // and an empty intersection is the correct answer, not a reason to widen.
    expect(tiles(result.current)).toHaveLength(0);
    expect(result.current.totals.idle).toBe(7);
  });

  it('drops sessions from a filtered board rather than piling them in the tray', () => {
    const groups: SessionGrouping = {
      byTeam: new Map([['t3', [session('s1')]]]),
      ungrouped: [session('s2')],
    };
    const { result } = renderHook(
      () => useBoardModel(roster(), personas, teams, groups, ACTIONABLE),
    );
    expect(result.current.traySessions).toHaveLength(0);
    expect(result.current.columns.flatMap((c) => c.rows.filter((r) => r.kind === 'session'))).toHaveLength(0);
  });
});
