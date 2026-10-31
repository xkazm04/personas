// @vitest-environment node
// A PARTIAL backfill must leave the missed-runs badge in place. `backfill_schedule`
// answers Ok with `capped: true` when it hit the per-request slot cap or the
// per-persona hourly ceiling (commands/execution/scheduler.rs: it can stop before
// enqueuing anything), and with `failures > 0` when some slot publishes failed.
// Clearing the badge on either drops the rest of the gap from the only list that
// remembers it, while the call reports success.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...(a as [])),
}));

import { backfillAllMissedRuns } from '../scheduler';

const row = {
  triggerId: 't1',
  missedCount: 400,
  firstMissedAt: '2026-09-15T02:00:00Z',
  lastMissedAt: '2026-09-18T02:00:00Z',
  statusReason: null,
  statusReasonDetail: null,
};

function route(result: Record<string, unknown>) {
  invokeWithTimeout.mockImplementation((cmd: string) => {
    if (cmd === 'list_schedule_missed_runs') return Promise.resolve([row]);
    if (cmd === 'backfill_schedule') {
      return Promise.resolve({
        triggerId: 't1', windowStart: 'x', windowEnd: 'y', slotTimes: [], ...result,
      });
    }
    if (cmd === 'clear_schedule_missed_runs') return Promise.resolve(null);
    return Promise.reject(new Error(`unexpected command ${cmd}`));
  });
}

const clears = () => invokeWithTimeout.mock.calls.filter((c) => c[0] === 'clear_schedule_missed_runs').length;

describe('backfillAllMissedRuns on a partial backfill', () => {
  beforeEach(() => { invokeWithTimeout.mockReset(); });

  it('keeps the badge when the backend capped the window', async () => {
    route({ slotsEnqueued: 100, capped: true, failures: 0 });
    const [r] = await backfillAllMissedRuns();
    expect(r!.error).toBeNull();
    expect(r!.cleared).toBe(false);
    expect(clears()).toBe(0);
  });

  it('keeps the badge when the hourly ceiling stopped it before any slot', async () => {
    route({ slotsEnqueued: 0, capped: true, failures: 0 });
    const [r] = await backfillAllMissedRuns();
    expect(r!.cleared).toBe(false);
    expect(clears()).toBe(0);
  });

  it('keeps the badge when some slot publishes failed', async () => {
    route({ slotsEnqueued: 3, capped: false, failures: 2 });
    const [r] = await backfillAllMissedRuns();
    expect(r!.cleared).toBe(false);
    expect(clears()).toBe(0);
  });

  it('still clears a complete backfill', async () => {
    route({ slotsEnqueued: 5, capped: false, failures: 0 });
    const [r] = await backfillAllMissedRuns();
    expect(r!.cleared).toBe(true);
    expect(clears()).toBe(1);
  });
});
