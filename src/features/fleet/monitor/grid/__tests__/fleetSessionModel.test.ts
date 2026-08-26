// fleetSessionModel — the session layer under the Activity board.
//
// The first test is the important one: SESSION_BORDER duplicates the hue
// decisions in FLEET_STATE_META because Tailwind cannot generate a class built
// at runtime. Duplication is only safe while something compares the two copies,
// so a hue change in the canonical table must fail HERE rather than quietly
// giving sessions a different colour in the Monitor than in the Fleet page.

import { describe, it, expect } from 'vitest';
import { FLEET_STATE_META } from '@/features/plugins/fleet/fleetStateMeta';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import {
  SESSION_BORDER, groupSessions, isLiveSession, sessionGlyph, sessionLabel, sessionStateMeta,
} from '../fleetSessionModel';

function session(o: Partial<FleetSession> & { id: string }): FleetSession {
  return {
    claudeSessionId: null, cwd: 'C:/repo', projectLabel: 'repo', name: null, title: null,
    args: [], mode: 'interactive', state: 'running' as FleetSessionState,
    lastActivityMs: 0n, lastPtyOutputMs: 0n, lastGrewMs: 0n, createdAtMs: 0n,
    childPid: null, exitCode: null, stateReason: null, athenaActive: false, dozing: false,
    limitResetAtMs: null, staleKind: null,
    ...o,
  } as unknown as FleetSession;
}

const project = (root: string, teamId: string | null): DevProject =>
  ({ id: `p-${root}`, root_path: root, team_id: teamId } as unknown as DevProject);

describe('SESSION_BORDER', () => {
  it('stays in lockstep with the canonical FLEET_STATE_META palette', () => {
    for (const meta of FLEET_STATE_META) {
      expect(SESSION_BORDER[meta.id]).toBe(meta.dot.replace('bg-', 'border-'));
    }
  });

  it('covers every lifecycle state', () => {
    expect(Object.keys(SESSION_BORDER).sort()).toEqual(FLEET_STATE_META.map((m) => m.id).sort());
  });
});

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
