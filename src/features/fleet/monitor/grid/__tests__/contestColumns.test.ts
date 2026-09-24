// Contest columns on the Activity board.
//
// A contest's seats are one piece of work spread over several engines, so the
// board gives each contest a column of its own (after the team columns) rather
// than scattering its seats through the tray. Three claims:
//
//  • one column per contest, carrying only that contest's seats, keyed by the
//    run-group key and named by the contest id (data — no string of its own);
//  • a filtered board carries no sessions, contest seats included;
//  • a board whose only content is a contest is not "empty".

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { groupSessions } from '../fleetSessionModel';
import { CONTEST_COLUMN_COLOR, useBoardModel } from '../useBoardModel';

const seat = (id: string, contestId: string, createdAtMs = 1): FleetSession =>
  ({
    id, state: 'running', cwd: `C:/work/alpha/.contest/arena/${contestId}/entries/${id}`,
    runLabel: `contest:${contestId}:${id}`, contestId, createdAtMs,
  } as unknown as FleetSession);

const team = (id: string): PersonaTeam =>
  ({ id, name: id, color: '#fff', project_id: `proj-${id}` } as unknown as PersonaTeam);

describe('contest columns', () => {
  it('renders one column per contest after the team columns, holding only its seats', () => {
    const groups = groupSessions(
      [seat('claude-a', 'c1', 5), seat('codex-b', 'c1', 6), seat('grok-c', 'c2', 9)],
      [],
    );
    const { result } = renderHook(() => useBoardModel([], [], [team('t1')], groups));
    const contestColumns = result.current.columns.filter((c) => c.contestId !== null);
    expect(contestColumns.map((c) => c.teamId)).toEqual(['contest:c2', 'contest:c1']);
    const c1 = contestColumns.find((c) => c.contestId === 'c1')!;
    expect(c1.teamName).toBe('c1');
    expect(c1.teamColor).toBe(CONTEST_COLUMN_COLOR);
    expect(c1.cards).toEqual([]);
    expect(c1.workspaceId).toBeNull();
    expect(c1.rows.map((r) => r.kind)).toEqual(['divider', 'session', 'session']);
    // Seats are not strays: nothing of a contest lands in the tray.
    expect(result.current.traySessions).toEqual([]);
    expect(result.current.empty).toBe(false);
  });

  it('keeps team columns flagged as not-a-contest', () => {
    const groups = groupSessions([seat('s', 'c1')], []);
    const { result } = renderHook(() => useBoardModel([], [], [], groups));
    expect(result.current.columns.every((c) => (c.contestId === null) === !c.teamId.startsWith('contest:'))).toBe(true);
  });

  it('drops contest columns from a filtered board, like every other session', () => {
    const groups = groupSessions([seat('s', 'c1')], []);
    const { result } = renderHook(() =>
      useBoardModel([], [], [], groups, { actionableOnly: true, state: null }));
    expect(result.current.columns.filter((c) => c.contestId !== null)).toEqual([]);
  });
});
