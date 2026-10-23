/**
 * What a started build is doing, read off the fleet's sessions (/perfect wave 1, direction 3): the lifecycle map is
 * a table, an unknown state never reads as done, and the label join is exact.
 */
import { describe, expect, it } from 'vitest';
import { SILENT_AFTER_MS, belongsTo, classOf, coveredBy, deriveStart, type SessionLite } from '../live/startedModel';
import { startElapsed, tallyRuns } from '../ui/rail/panels/agentsModel';
import type { Run } from '@/lib/lensScan/wire';

const LABEL = 'personas:1111';
const session = (over: Partial<SessionLite> = {}): SessionLite => ({
  id: 's1', state: 'running', exitCode: null, runLabel: `fleet-door:lens_scan:${LABEL}`, createdAtMs: 1_000, lastActivityMs: 2_000, ...over,
} as SessionLite);

describe('belongsTo', () => {
  it('matches the label after the dispatcher prefix, and nothing that merely contains it', () => {
    expect(belongsTo(session(), LABEL)).toBe(true);
    expect(belongsTo(session({ runLabel: LABEL }), LABEL)).toBe(true);
    expect(belongsTo(session({ runLabel: `fleet-door:lens_scan:${LABEL}0` }), LABEL)).toBe(false);
    expect(belongsTo(session({ runLabel: `fleet-door:lens_scan:x${LABEL}` }), LABEL)).toBe(false);
    expect(belongsTo(session({ runLabel: null }), LABEL)).toBe(false);
  });
});

describe('classOf', () => {
  it.each([
    ['queued', null, 'queued'], ['spawning', null, 'running'], ['running', null, 'running'],
    ['awaiting_input', null, 'waiting'], ['stale', null, 'waiting'], ['idle', null, 'waiting'], ['hibernated', null, 'waiting'],
    ['finished', null, 'clean'], ['exited', 0, 'clean'], ['exited', 1, 'bad'], ['exited', null, 'clean'], ['expired', null, 'bad'],
  ])('%s (exit %s) is %s', (state, exitCode, want) => {
    expect(classOf({ state, exitCode } as Pick<SessionLite, 'state' | 'exitCode'>)).toBe(want);
  });

  it('a state this map does not know is waiting, never done', () => {
    expect(classOf({ state: 'brand_new_state', exitCode: 0 } as unknown as Pick<SessionLite, 'state' | 'exitCode'>)).toBe('waiting');
  });
});

describe('deriveStart', () => {
  const at = 5_000;
  it('no session yet is queued, and silent (settled) only after the window', () => {
    expect(deriveStart([], at, at + 1_000)).toMatchObject({ phase: 'queued', settled: false, sessions: 0 });
    expect(deriveStart([], at, at + SILENT_AFTER_MS + 1)).toMatchObject({ phase: 'silent', settled: true });
  });

  it('follows a session queued -> running -> done', () => {
    expect(deriveStart([session({ state: 'queued' })], at, 9_000).phase).toBe('queued');
    expect(deriveStart([session({ state: 'running' })], at, 9_000)).toMatchObject({ phase: 'running', live: 1, settled: false, until: null });
    const done = deriveStart([session({ state: 'exited', exitCode: 0, lastActivityMs: 8_000 })], at, 9_000);
    expect(done).toMatchObject({ phase: 'done', live: 0, settled: true, since: 1_000, until: 8_000 });
  });

  it('a session that ended badly is failed; a parked one is waiting and outranks running', () => {
    expect(deriveStart([session({ state: 'exited', exitCode: 2 })], at, 9_000)).toMatchObject({ phase: 'failed', settled: true });
    expect(deriveStart([session({ id: 'a', state: 'running' }), session({ id: 'b', state: 'awaiting_input' })], at, 9_000).phase).toBe('waiting');
    // a failure among live sessions shows at once, but the build is not settled until nothing is alive
    const mixed = deriveStart([session({ id: 'a', state: 'exited', exitCode: 1 }), session({ id: 'b', state: 'running' })], at, 9_000);
    expect(mixed).toMatchObject({ phase: 'failed', settled: false, sessions: 2, live: 1 });
  });

  it('elapsed runs to now while unsettled and stops at the end once settled', () => {
    const live = deriveStart([session()], at, 9_000);
    expect(startElapsed(live, 9_000)).toBe(8_000);
    const done = deriveStart([session({ state: 'exited', exitCode: 0, lastActivityMs: 4_000 })], at, 9_000);
    expect(startElapsed(done, 99_000)).toBe(3_000);
  });
});

describe('a store run still covering the start', () => {
  const at = 5_000;
  const exited = [session({ state: 'exited', exitCode: 0, lastActivityMs: 8_000 })];

  it('all sessions exited but a covering run still runs: not settled, not done, ended edge is up', () => {
    const st = deriveStart(exited, at, 9_000, true);
    expect(st).toMatchObject({ phase: 'running', settled: false, ended: true, until: null });
  });

  it('the store run ends: done and settled', () => {
    expect(deriveStart(exited, at, 9_000, false)).toMatchObject({ phase: 'done', settled: true, ended: true });
  });

  it('a covering run keeps a session-less start from going silent', () => {
    expect(deriveStart([], at, at + SILENT_AFTER_MS + 1, true)).toMatchObject({ phase: 'queued', settled: false });
  });

  it('coveredBy reads the execute run scope.proposals, and only while it runs', () => {
    const run = (over: object) => ({ status: 'running', phase: 'execute', scope: { proposals: ['p1', 'p2'] }, ...over }) as unknown as Run;
    expect(coveredBy([run({})], ['p2', 'p9'])).toBe(true);
    expect(coveredBy([run({})], ['p9'])).toBe(false);
    expect(coveredBy([run({ status: 'done' })], ['p1'])).toBe(false);
    expect(coveredBy([run({ phase: 'measure' })], ['p1'])).toBe(false);
    expect(coveredBy([run({ scope: { proposals: ['*'] } })], ['p9'])).toBe(true);
    expect(coveredBy([run({ scope: null })], ['p1'])).toBe(false);
  });
});

describe('tallyRuns', () => {
  it('counts an aborted run apart from a failed one', () => {
    const runs = (['running', 'done', 'failed', 'aborted', 'aborted'] as const).map((status) => ({ status })) as unknown as Run[];
    expect(tallyRuns(runs)).toEqual({ running: 1, done: 1, failed: 1, aborted: 2 });
  });
});
