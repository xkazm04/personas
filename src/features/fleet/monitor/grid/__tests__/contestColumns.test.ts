// Contest columns on the Activity board.
//
// A contest's seats are one piece of work spread over several engines, so the
// board gives each contest a column of its own (after the team columns) rather
// than scattering its seats through the tray. Three claims:
//
//  • one column per contest, carrying only that contest's seats, keyed by the
//    run-group key and named by the contest id (data — no string of its own);
//  • a filtered board carries no sessions, contest seats included;
//  • a board whose only content is a contest is not "empty";
//  • a contest is (project, contest): two projects' same-slug contests are two
//    columns, and a seat labelled before the project joined the label still
//    groups, by its id alone and with no project.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { groupSessions } from '../fleetSessionModel';
import { CONTEST_COLUMN_COLOR, useBoardModel } from '../useBoardModel';

const seat = (id: string, contestId: string, createdAtMs = 1, projectId: string | null = 'p-alpha'): FleetSession =>
  ({
    id, state: 'running', cwd: `C:/work/alpha/.contest/arena/${contestId}/entries/${id}`,
    runLabel: projectId ? `contest:${projectId}/${contestId}:${id}` : `contest:${contestId}:${id}`,
    contestId, contestProjectId: projectId, createdAtMs,
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
    expect(contestColumns.map((c) => c.teamId)).toEqual(['contest:p-alpha/c2', 'contest:p-alpha/c1']);
    const c1 = contestColumns.find((c) => c.contestId === 'c1')!;
    expect(c1.teamName).toBe('c1');
    expect(c1.contestProjectId).toBe('p-alpha');
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

  it('gives two projects\' same-id contests a column each, never one merged column', () => {
    const groups = groupSessions(
      [
        seat('claude-opus_xhigh', 'onboarding', 5, 'p-alpha'),
        seat('codex-sol_high', 'onboarding', 6, 'p-alpha'),
        seat('claude-opus_xhigh', 'onboarding', 7, 'p-beta'),
      ],
      [],
    );
    const { result } = renderHook(() => useBoardModel([], [], [], groups));
    const cols = result.current.columns.filter((c) => c.contestId !== null);
    expect(cols.map((c) => [c.teamId, c.contestProjectId, c.contestId])).toEqual([
      ['contest:p-beta/onboarding', 'p-beta', 'onboarding'],
      ['contest:p-alpha/onboarding', 'p-alpha', 'onboarding'],
    ]);
    expect(cols.map((c) => c.rows.filter((r) => r.kind === 'session').length)).toEqual([1, 2]);
  });

  it('still groups a seat whose label predates the project, by its id alone', () => {
    const groups = groupSessions([seat('a', 'c1', 1, null), seat('b', 'c1', 2, null)], []);
    const { result } = renderHook(() => useBoardModel([], [], [], groups));
    const cols = result.current.columns.filter((c) => c.contestId !== null);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.teamId).toBe('contest:c1');
    expect(cols[0]!.contestId).toBe('c1');
    expect(cols[0]!.contestProjectId).toBeNull();
    expect(cols[0]!.rows.filter((r) => r.kind === 'session')).toHaveLength(2);
  });

  it('drops contest columns from a filtered board, like every other session', () => {
    const groups = groupSessions([seat('s', 'c1')], []);
    const { result } = renderHook(() =>
      useBoardModel([], [], [], groups, { actionableOnly: true, state: null }));
    expect(result.current.columns.filter((c) => c.contestId !== null)).toEqual([]);
  });
});
