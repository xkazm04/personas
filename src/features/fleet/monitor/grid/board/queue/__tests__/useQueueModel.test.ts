// buildQueueModel — the join of registry rows and the queue snapshot.
//
// The property under test is that a board never drops a row it can see and
// never invents a rank it was not given: queued rows order by the snapshot's
// rank, rows the snapshot has not caught up with trail in registry order with
// `rank: null`, and everything not queued is a locked, slot-holding row.

import { describe, it, expect } from 'vitest';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';
import { buildQueueModel, asOrigin } from '../useQueueModel';

function session(partial: Partial<FleetSession> & { id: string }): FleetSession {
  return {
    claudeSessionId: null,
    cwd: `/repo/${partial.id}`,
    projectLabel: partial.id,
    name: null,
    title: null,
    args: [],
    mode: 'interactive',
    state: 'running',
    lastActivityMs: BigInt(0),
    lastPtyOutputMs: BigInt(0),
    lastGrewMs: BigInt(0),
    createdAtMs: BigInt(1_000),
    childPid: null,
    exitCode: null,
    stateReason: null,
    athenaActive: false,
    dozing: false,
    limitResetAtMs: null,
    staleKind: null,
    queueRank: null,
    queuedAtMs: null,
    notBeforeMs: null,
    origin: null,
    personaId: null,
    goalId: null,
    cycleIndex: null,
    ...partial,
  };
}

function snapshot(partial: Partial<FleetQueueSnapshot> = {}): FleetQueueSnapshot {
  return { cap: 10, running: 0, queued: 0, overAdmitted: 0, entries: [], ...partial };
}

describe('buildQueueModel', () => {
  it('orders queued rows by snapshot rank and running rows by createdAt ascending', () => {
    const sessions = [
      session({ id: 'q-b', state: 'queued', queueRank: 2 }),
      session({ id: 'r-new', state: 'running', createdAtMs: BigInt(5_000) }),
      session({ id: 'q-a', state: 'queued', queueRank: 1 }),
      session({ id: 'r-old', state: 'awaiting_input', createdAtMs: BigInt(1_000) }),
    ];
    const snap = snapshot({
      running: 2, queued: 2,
      entries: [
        { sessionId: 'q-b', rank: 2, origin: 'autopilot', personaId: 'p1', goalId: null, queuedAtMs: 1, notBeforeMs: null, estimatedStartMs: 20_000 },
        { sessionId: 'q-a', rank: 1, origin: 'manual', personaId: null, goalId: null, queuedAtMs: 0, notBeforeMs: null, estimatedStartMs: 10_000 },
      ],
    });
    const m = buildQueueModel(sessions, snap);
    expect(m.queued.map((i) => i.sessionId)).toEqual(['q-a', 'q-b']);
    expect(m.queued.map((i) => i.rank)).toEqual([1, 2]);
    expect(m.running.map((i) => i.sessionId)).toEqual(['r-old', 'r-new']);
    expect(m.queued[1]!.estimatedStartMs).toBe(20_000);
    expect(m.queued[1]!.origin).toBe('autopilot');
    expect(m.queued[1]!.personaId).toBe('p1');
  });

  it('passes cap and overAdmitted through, and reports empty honestly', () => {
    const m = buildQueueModel([], snapshot({ cap: 4, overAdmitted: 2 }));
    expect(m.cap).toBe(4);
    expect(m.overAdmitted).toBe(2);
    expect(m.empty).toBe(true);
    const none = buildQueueModel([session({ id: 'r' })], null);
    expect(none.cap).toBe(0);
    expect(none.overAdmitted).toBe(0);
    expect(none.empty).toBe(false);
  });

  it('locks every row that is not queued, and only those', () => {
    const m = buildQueueModel(
      [session({ id: 'q', state: 'queued' }), session({ id: 'r', state: 'idle' }), session({ id: 's', state: 'spawning' })],
      snapshot(),
    );
    expect(m.queued.map((i) => i.locked)).toEqual([false]);
    expect(m.running.map((i) => i.locked)).toEqual([true, true]);
  });

  it('keeps a queued row the snapshot has not caught up with, after the ranked ones, in registry order', () => {
    const sessions = [
      session({ id: 'late-2', state: 'queued', queueRank: 3 }),
      session({ id: 'known', state: 'queued', queueRank: 2 }),
      session({ id: 'late-1', state: 'queued', queueRank: 1 }),
    ];
    const snap = snapshot({
      entries: [{ sessionId: 'known', rank: 1, origin: 'manual', personaId: null, goalId: null, queuedAtMs: 0, notBeforeMs: null, estimatedStartMs: null }],
    });
    const m = buildQueueModel(sessions, snap);
    expect(m.queued.map((i) => i.sessionId)).toEqual(['known', 'late-1', 'late-2']);
    expect(m.queued.map((i) => i.rank)).toEqual([1, null, null]);
    expect(m.queued[1]!.estimatedStartMs).toBeNull();
  });

  it('drops exited rows from both lists', () => {
    const m = buildQueueModel([session({ id: 'x', state: 'exited' })], snapshot());
    expect(m.empty).toBe(true);
  });

  it('resolves a team from the cwd first, then from the persona home team', () => {
    const projects = [{ id: 'p', name: 'p', root_path: '/repo/by-cwd', team_id: 'team-cwd' }];
    const personas = [{ id: 'persona-1', home_team_id: 'team-home' }];
    const teams = [{ id: 'team-cwd' }, { id: 'team-home' }];
    const m = buildQueueModel(
      [
        session({ id: 'by-cwd', state: 'queued', cwd: '/repo/by-cwd', personaId: 'persona-1' }),
        session({ id: 'by-persona', state: 'queued', cwd: '/elsewhere', personaId: 'persona-1' }),
        session({ id: 'nowhere', state: 'queued', cwd: '/elsewhere' }),
      ],
      snapshot(),
      // Only the fields the join reads are provided; the bindings carry many more.
      personas as never,
      teams as never,
      projects as never,
    );
    expect(m.queued.map((i) => i.teamId)).toEqual(['team-cwd', 'team-home', undefined]);
  });
});

describe('asOrigin', () => {
  it('maps unknown or missing tokens to manual', () => {
    expect(asOrigin(null)).toBe('manual');
    expect(asOrigin('bogus')).toBe('manual');
    expect(asOrigin('night_shift')).toBe('night_shift');
  });
});
