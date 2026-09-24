// fleetSessionModel — the session layer under the Activity board.
//
// The hue tables the node paints with (`SESSION_TINT`) are pinned to the
// canonical palette in `board/node/__tests__/nodeSymbols.test.ts`.

import { describe, it, expect } from 'vitest';
import { FLEET_STATE_META } from '@/features/plugins/fleet/fleetStateMeta';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import {
  contestGroupKey, contestIdOfGroupKey,
  groupSessions, isLiveSession, sessionGlyph, sessionLabel, sessionStateMeta,
} from '../fleetSessionModel';

function session(o: Partial<FleetSession> & { id: string }): FleetSession {
  return {
    claudeSessionId: null, cwd: 'C:/repo', projectLabel: 'repo', name: null, title: null,
    args: [], mode: 'interactive', state: 'running' as FleetSessionState,
    lastActivityMs: 0n, lastPtyOutputMs: 0n, lastGrewMs: 0n, createdAtMs: 0n,
    childPid: null, exitCode: null, stateReason: null, athenaActive: false, dozing: false,
    limitResetAtMs: null, staleKind: null, runLabel: null, runId: null, contestId: null,
    ...o,
  } as unknown as FleetSession;
}

const project = (root: string, teamId: string | null): DevProject =>
  ({ id: `p-${root}`, root_path: root, team_id: teamId } as unknown as DevProject);

describe('sessionStateMeta', () => {
  it('resolves a known state', () => {
    expect(sessionStateMeta('awaiting_input').labelKey).toBe('state_awaiting_input');
  });
  it('falls back to the terminal state for an unknown one', () => {
    expect(sessionStateMeta('nonsense' as FleetSessionState).id).toBe('exited');
  });
});

describe('isLiveSession', () => {
  it('keeps everything but exited', () => {
    const states = FLEET_STATE_META.map((m) => m.id);
    expect(states.filter((s) => !isLiveSession({ state: s }))).toEqual(['exited']);
  });
});

describe('sessionLabel / sessionGlyph', () => {
  it('prefers the live terminal title over the name and the project', () => {
    expect(sessionLabel(session({ id: 'a', title: 'Fix login', name: 'nm', projectLabel: 'pl' }))).toBe('Fix login');
    expect(sessionLabel(session({ id: 'a', title: null, name: 'nm', projectLabel: 'pl' }))).toBe('nm');
    expect(sessionLabel(session({ id: 'a', title: null, name: null, projectLabel: 'pl' }))).toBe('pl');
  });

  it('takes word initials when there are several words, letters when there is one', () => {
    expect(sessionGlyph(session({ id: 'a', title: 'build api docs' }))).toBe('BAD');
    expect(sessionGlyph(session({ id: 'a', title: 'refactor' }))).toBe('REF');
    // Punctuation-heavy titles (a slug, a claude command) must not produce
    // punctuation glyphs: '/scan-sweep --deep' reads as three words.
    expect(sessionGlyph(session({ id: 'a', title: '/scan-sweep --deep' }))).toBe('SSD');
  });

  it('never renders empty', () => {
    expect(sessionGlyph(session({ id: 'abcdef12', title: '///', name: null, projectLabel: '' })).length).toBeGreaterThan(0);
  });
});

describe('groupSessions', () => {
  const projects = [project('C:/work/alpha', 't1'), project('C:/work/beta', null)];

  it('maps a session to a team column through cwd → project → team_id', () => {
    const g = groupSessions([session({ id: 's1', cwd: 'C:/work/alpha' })], projects);
    expect([...g.byTeam.keys()]).toEqual(['t1']);
    expect(g.ungrouped).toEqual([]);
  });

  it('normalizes separators, case and trailing slash the way fleetSlice does', () => {
    const g = groupSessions([session({ id: 's1', cwd: 'c:\\WORK\\Alpha\\' })], projects);
    expect(g.byTeam.get('t1')).toHaveLength(1);
  });

  it('sends a project with no team, and an unregistered cwd, to ungrouped', () => {
    const g = groupSessions(
      [session({ id: 's1', cwd: 'C:/work/beta' }), session({ id: 's2', cwd: 'C:/elsewhere' })],
      projects,
    );
    expect(g.byTeam.size).toBe(0);
    expect(g.ungrouped.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('drops exited sessions but keeps every other state', () => {
    const g = groupSessions(
      [
        session({ id: 'dead', cwd: 'C:/work/alpha', state: 'exited' }),
        session({ id: 'done', cwd: 'C:/work/alpha', state: 'finished' }),
      ],
      projects,
    );
    expect(g.byTeam.get('t1')!.map((s) => s.id)).toEqual(['done']);
  });

  it('sorts attention-first, then newest', () => {
    const g = groupSessions(
      [
        session({ id: 'old-run', cwd: 'C:/work/alpha', state: 'running', createdAtMs: 10n }),
        session({ id: 'new-run', cwd: 'C:/work/alpha', state: 'running', createdAtMs: 90n }),
        session({ id: 'asks', cwd: 'C:/work/alpha', state: 'awaiting_input', createdAtMs: 1n }),
      ],
      projects,
    );
    expect(g.byTeam.get('t1')!.map((s) => s.id)).toEqual(['asks', 'new-run', 'old-run']);
  });

  it('returns empty groups when no projects are loaded yet, never throwing', () => {
    const g = groupSessions([session({ id: 's1' })], []);
    expect(g.byTeam.size).toBe(0);
    expect(g.ungrouped).toHaveLength(1);
  });
});

describe('contest run groups', () => {
  const projects = [project('C:/work/alpha', 't1')];

  it('round-trips a contest id through its run-group key, and nothing else', () => {
    expect(contestIdOfGroupKey(contestGroupKey('home-hero'))).toBe('home-hero');
    expect(contestIdOfGroupKey('t1')).toBeNull();
    expect(contestIdOfGroupKey('contest:')).toBeNull();
  });

  it('puts every seat of a contest in one run group, never in a team column or the tray', () => {
    const g = groupSessions(
      [
        // A seat whose cwd happens to be a team's project root still belongs to its contest.
        session({ id: 'a', cwd: 'C:/work/alpha', runLabel: 'contest:c1:claude-opus_xhigh', contestId: 'c1' }),
        session({ id: 'b', cwd: 'C:/work/alpha/.contest/arena/c1/entries/codex', runLabel: 'contest:c1:codex-sol_high', contestId: 'c1' }),
        session({ id: 'plain', cwd: 'C:/work/alpha', runLabel: 'app-master:p1' }),
        session({ id: 'stray', cwd: 'C:/elsewhere', runLabel: 'contest notes' }),
      ],
      projects,
    );
    expect([...g.byRun.keys()]).toEqual(['contest:c1']);
    expect(g.byRun.get('contest:c1')!.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(g.byTeam.get('t1')!.map((s) => s.id)).toEqual(['plain']);
    expect(g.ungrouped.map((s) => s.id)).toEqual(['stray']);
  });

  it('orders contests newest first, sorts seats attention-first, and drops exited seats', () => {
    const g = groupSessions(
      [
        session({ id: 'old', runLabel: 'contest:older:s1', contestId: 'older', createdAtMs: 10n }),
        session({ id: 'new-run', runLabel: 'contest:newer:s1', contestId: 'newer', state: 'running', createdAtMs: 50n }),
        session({ id: 'new-asks', runLabel: 'contest:newer:s2', contestId: 'newer', state: 'awaiting_input', createdAtMs: 40n }),
        session({ id: 'gone', runLabel: 'contest:gone:s1', contestId: 'gone', state: 'exited', createdAtMs: 99n }),
      ],
      projects,
    );
    expect([...g.byRun.keys()]).toEqual(['contest:newer', 'contest:older']);
    expect(g.byRun.get('contest:newer')!.map((s) => s.id)).toEqual(['new-asks', 'new-run']);
  });
});
