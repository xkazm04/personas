// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...(a as [])),
}));

import { backfillAllMissedRuns } from '../scheduler';

describe('backfillAllMissedRuns with an IPC AppError', () => {
  it('reports the AppError text, not "[object Object]"', async () => {
    invokeWithTimeout.mockImplementation((cmd: string) => {
      if (cmd === 'list_schedule_missed_runs') {
        return Promise.resolve([{
          triggerId: 't1', missedCount: 1, firstMissedAt: '2026-09-15T02:00:00Z',
          lastMissedAt: '2026-09-15T02:00:00Z', statusReason: null, statusReasonDetail: null,
        }]);
      }
      return Promise.reject({ error: 'schedule is paused', kind: 'validation' });
    });
    const [r] = await backfillAllMissedRuns();
    expect(r!.error).toBe('schedule is paused');
  });
});
