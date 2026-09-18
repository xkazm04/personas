import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...(a as [])),
}));

import { backfillAllMissedRuns } from '../scheduler';

const row = (over: Record<string, unknown> = {}) => ({
  triggerId: 't1',
  missedCount: 3,
  firstMissedAt: '2026-09-15T02:00:00Z',
  lastMissedAt: '2026-09-15T02:00:00Z',
  statusReason: null,
  statusReasonDetail: null,
  ...over,
});

const backfilled = (triggerId: string) => ({
  triggerId,
  windowStart: 'x',
  windowEnd: 'y',
  slotsEnqueued: 2,
  capped: false,
  slotTimes: [],
  failures: 0,
});

/** Route each command name to a handler; an unrouted name fails loudly. */
function routeInvoke(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  invokeWithTimeout.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`unexpected command ${cmd}`);
    return Promise.resolve(h(args ?? {}));
  });
}

const calls = (cmd: string) => invokeWithTimeout.mock.calls.filter((c) => c[0] === cmd);

describe('backfillAllMissedRuns', () => {
  // Braces matter: a beforeEach that RETURNS mockReset()'s value hands vitest
  // the mock itself as a cleanup function, which it then calls with no args.
  beforeEach(() => { invokeWithTimeout.mockReset(); });

  it('fills every listed trigger and clears the ones that succeeded', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row({ triggerId: 't1' }), row({ triggerId: 't2' })],
      backfill_schedule: (a) => backfilled(String(a.triggerId)),
      clear_schedule_missed_runs: () => null,
    });

    const out = await backfillAllMissedRuns();

    expect(out).toHaveLength(2);
    expect(out.every((o) => o.error === null && o.cleared)).toBe(true);
    expect(calls('backfill_schedule')).toHaveLength(2);
    expect(calls('clear_schedule_missed_runs').map((c) => (c[1] as { triggerId: string }).triggerId))
      .toEqual(['t1', 't2']);
  });

  it('opens the window at firstMissedAt and closes it at now', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row({ firstMissedAt: '2026-09-13T01:00:00Z', lastMissedAt: '2026-09-15T02:00:00Z' })],
      backfill_schedule: (a) => backfilled(String(a.triggerId)),
      clear_schedule_missed_runs: () => null,
    });

    await backfillAllMissedRuns();

    const args = calls('backfill_schedule')[0]![1] as { start: string; end: string };
    expect(args.start).toBe('2026-09-13T01:00:00Z');
    // Closing at `now` is what keeps a single-detection row a non-empty window
    // (the backend rejects end <= start).
    expect(new Date(args.end).getTime()).toBeGreaterThan(new Date(args.start).getTime());
  });

  it('leaves a failed trigger on the list', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row({ triggerId: 'ok' }), row({ triggerId: 'bad' })],
      backfill_schedule: (a) => {
        if (a.triggerId === 'bad') throw new Error('backfill is only supported for schedule triggers');
        return backfilled(String(a.triggerId));
      },
      clear_schedule_missed_runs: () => null,
    });

    const out = await backfillAllMissedRuns();

    const bad = out.find((o) => o.triggerId === 'bad')!;
    expect(bad.error).toContain('only supported for schedule triggers');
    expect(bad.cleared).toBe(false);
    expect(calls('clear_schedule_missed_runs')).toHaveLength(1);
  });

  it('skips a row with no recorded window instead of clearing its badge', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row({ firstMissedAt: null, lastMissedAt: null, statusReason: 'invalid_timezone' })],
      backfill_schedule: () => backfilled('t1'),
      clear_schedule_missed_runs: () => null,
    });

    const out = await backfillAllMissedRuns();

    expect(out[0]!.error).toBe('no recorded missed window');
    expect(calls('backfill_schedule')).toHaveLength(0);
    expect(calls('clear_schedule_missed_runs')).toHaveLength(0);
  });

  it('restricts to the named triggers when asked', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row({ triggerId: 't1' }), row({ triggerId: 't2' })],
      backfill_schedule: (a) => backfilled(String(a.triggerId)),
      clear_schedule_missed_runs: () => null,
    });

    const out = await backfillAllMissedRuns(['t2']);

    expect(out.map((o) => o.triggerId)).toEqual(['t2']);
    expect(calls('backfill_schedule')).toHaveLength(1);
  });

  it('reports a cleared=false success when only the badge write fails', async () => {
    routeInvoke({
      list_schedule_missed_runs: () => [row()],
      backfill_schedule: (a) => backfilled(String(a.triggerId)),
      clear_schedule_missed_runs: () => { throw new Error('database is locked'); },
    });

    const out = await backfillAllMissedRuns();

    // The slots are enqueued; calling this a failure would invite a double fill.
    expect(out[0]!.error).toBeNull();
    expect(out[0]!.result?.slotsEnqueued).toBe(2);
    expect(out[0]!.cleared).toBe(false);
  });
});
