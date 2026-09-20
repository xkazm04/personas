// The workspace's cross-project group, as the board's model sees it.
//
// Three claims, and each one is invisible in a screenshot of a healthy machine:
//
//  • an EMPTY group still gets a column, while an empty project team still does
//    not — the exemption has to be exactly one team wide, or the board fills up
//    with the empty project rosters it spent its life suppressing;
//  • groups sit FIRST and nothing else moves — the query orders by
//    `updated_at DESC`, so the only thing that can pin a column is a stable
//    partition here, and "stable" is the half that a sort would quietly lose;
//  • `empty` still answers "nobody here" — a group renders while it is empty,
//    so a board that counted COLUMNS would have replaced its own empty state
//    with a row of empty frames the day the first workspace was created.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../monitorModel';
import type { SessionGrouping } from '../fleetSessionModel';
import { groupFleet } from '../fleetGridModel';
import { useBoardModel } from '../useBoardModel';

const card = (personaId: string): PersonaCardModel => ({
  personaId, personaName: personaId, personaIcon: null, personaColor: null, enabled: true,
  reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
  reviewCount: 0, messages: [], messageCount: 0, processes: [],
  running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
  execState: 'idle', attentionCount: 0,
  healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
  liveCostUsd: 0, liveToolCalls: 0,
} as PersonaCardModel);

const persona = (id: string, teamId: string | null): Persona =>
  ({ id, home_team_id: teamId } as unknown as Persona);

/** A project's roster. The binding leaves `workspace_id` OUT, not null. */
const team = (id: string): PersonaTeam =>
  ({ id, name: id, color: '#fff', project_id: `proj-${id}` } as unknown as PersonaTeam);

/** A workspace's cross-project group: a workspace, and no project. */
const groupTeam = (id: string, workspaceId: string): PersonaTeam =>
  ({ id, name: id, color: '#fff', project_id: null, workspace_id: workspaceId } as unknown as PersonaTeam);

const session = (id: string): FleetSession => ({ id, state: 'running' } as unknown as FleetSession);
const NO_SESSIONS: SessionGrouping = { byTeam: new Map(), ungrouped: [] };

describe('groupFleet and the workspace group', () => {
  it('normalises the binding\'s OPTIONAL workspace_id into a plain nullable', () => {
    const { teams } = groupFleet(
      [card('p1'), card('p2')],
      [persona('p1', 't1'), persona('p2', 'g1')],
      [team('t1'), groupTeam('g1', 'ws-1')],
    );
    // `team()` omits the field entirely — the board must still read `null`
    // there, never `undefined`, or every `=== null` check downstream is a lie.
    expect(teams.find((g) => g.teamId === 't1')!.workspaceId).toBeNull();
    expect(teams.find((g) => g.teamId === 'g1')!.workspaceId).toBe('ws-1');
  });

  it('gives an empty workspace group a column and an empty project team none', () => {
    const { teams } = groupFleet([], [], [team('t1'), groupTeam('g1', 'ws-1')]);
    expect(teams.map((g) => g.teamId)).toEqual(['g1']);
    expect(teams[0]!.cards).toEqual([]);
  });

  it('still suppresses a project team whose personas are all missing', () => {
    // The card list is the fleet; a team whose members are not in it has
    // nothing to draw, and that rule is untouched by the exemption.
    const { teams } = groupFleet([card('p1')], [persona('p1', 't1')], [team('t1'), team('t2')]);
    expect(teams.map((g) => g.teamId)).toEqual(['t1']);
  });
});

describe('useBoardModel column order', () => {
  it('hoists every workspace group and leaves the rest in arrival order', () => {
    // Arrival order is `persona_teams.updated_at DESC`, so this is what a
    // freshly-written project team does to the list.
    const teams = [team('t1'), groupTeam('g1', 'ws-1'), team('t2'), groupTeam('g2', 'ws-2'), team('t3')];
    const personas = ['t1', 't2', 't3'].map((t, i) => persona(`p${i}`, t));
    const cards = personas.map((p) => card(p.id));
    const { result } = renderHook(() => useBoardModel(cards, personas, teams, NO_SESSIONS));
    expect(result.current.columns.map((c) => c.teamId)).toEqual(['g1', 'g2', 't1', 't2', 't3']);
  });

  it('returns the same array identity when there is nothing to hoist', () => {
    const teams = [team('t1'), team('t2')];
    const personas = [persona('p0', 't1'), persona('p1', 't2')];
    const cards = [card('p0'), card('p1')];
    const { result, rerender } = renderHook(() =>
      useBoardModel(cards, personas, teams, NO_SESSIONS));
    const first = result.current.columns;
    rerender();
    expect(result.current.columns).toBe(first);
  });
});

describe('useBoardModel emptiness', () => {
  it('is still empty when the only columns are empty workspace groups', () => {
    // Three workspaces, no personas, no sessions: the board has three columns
    // and nothing to say. The settled empty state has to win.
    const teams = [groupTeam('g1', 'ws-1'), groupTeam('g2', 'ws-2'), groupTeam('g3', 'ws-3')];
    const { result } = renderHook(() => useBoardModel([], [], teams, NO_SESSIONS));
    expect(result.current.columns).toHaveLength(3);
    expect(result.current.empty).toBe(true);
  });

  it('is not empty once a group carries a session, and the session leaves the tray', () => {
    const groups: SessionGrouping = { byTeam: new Map([['g1', [session('s1')]]]), ungrouped: [] };
    const { result } = renderHook(() =>
      useBoardModel([], [], [groupTeam('g1', 'ws-1')], groups));
    expect(result.current.empty).toBe(false);
    // It used to fall through to the tray, because an empty group had no
    // column to fall into.
    expect(result.current.traySessions).toEqual([]);
    expect(result.current.columns[0]!.rows.map((r) => r.kind)).toEqual(['divider', 'session']);
  });

  it('is not empty when an ordinary team has a card', () => {
    const { result } = renderHook(() =>
      useBoardModel([card('p0')], [persona('p0', 't1')], [team('t1'), groupTeam('g1', 'ws-1')], NO_SESSIONS));
    expect(result.current.empty).toBe(false);
    expect(result.current.columns.map((c) => c.teamId)).toEqual(['g1', 't1']);
  });
});
