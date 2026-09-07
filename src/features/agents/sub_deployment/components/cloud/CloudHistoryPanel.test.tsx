import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const listMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());
const outputMock = vi.hoisted(() => vi.fn());
const captured = vi.hoisted(() => ({ poll: null as null | (() => unknown) }));

vi.mock('@/api/system/cloud', () => ({
  cloudListExecutions: (...a: unknown[]) => listMock(...a),
  cloudExecutionStats: (...a: unknown[]) => statsMock(...a),
  cloudGetExecutionOutput: (...a: unknown[]) => outputMock(...a),
}));
vi.mock('@/hooks/utility/timing/usePolling', () => ({
  POLLING_CONFIG: { cloudHistory: { interval: 15_000, maxBackoff: 60_000 } },
  usePolling: (fn: () => unknown) => {
    captured.poll = fn;
    return { isPolling: true, lastRefreshed: 1 };
  },
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: unknown[] }) => unknown) => sel({ personas: [] }),
}));
vi.mock('@/hooks/usePersonaNameMap', () => ({ usePersonaNameMap: () => (id: string) => `persona:${id}` }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => vi.fn(), toastCatch: () => vi.fn() }));

import { CloudHistoryPanel } from './CloudHistoryPanel';

const exec = {
  id: 'ex-1', personaId: 'p1', projectId: null, status: 'completed', inputData: null,
  errorMessage: null, durationMs: 1200n, costUsd: 0.01, inputTokens: null, outputTokens: null,
  retryCount: null, startedAt: null, completedAt: null, createdAt: '2026-09-07T10:00:00Z',
};
const stats = { totalExecutions: 1, successRate: 1, totalCostUsd: 0.01, avgDurationMs: null, dailyBreakdown: [], topErrors: [] };

beforeEach(() => {
  listMock.mockReset(); statsMock.mockReset(); outputMock.mockReset();
  captured.poll = null;
});

describe('CloudHistoryPanel: output cache', () => {
  it('the row refresh control re-reads past the cache instead of serving the cached lines', async () => {
    listMock.mockResolvedValue([exec]);
    statsMock.mockResolvedValue(stats);
    outputMock.mockResolvedValue(['line 1']);
    render(<CloudHistoryPanel />);
    await act(async () => { await captured.poll!(); });

    fireEvent.click(screen.getByText('persona:p1'));
    await act(async () => { fireEvent.click(screen.getByText('View Output')); });
    expect(outputMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('line 1')).toBeTruthy();

    // Before the fix this went through the same cache read and was a no-op
    // for five minutes.
    await act(async () => { fireEvent.click(screen.getByTestId('cloud-exec-output-refresh-ex-1')); });
    expect(outputMock).toHaveBeenCalledTimes(2);
  });
});

describe('CloudHistoryPanel: the failed-poll trap', () => {
  it('a failed poll keeps the last good rows, marks them stale, and rethrows so usePolling backs off', async () => {
    listMock.mockResolvedValue([exec]);
    statsMock.mockResolvedValue(stats);
    render(<CloudHistoryPanel />);
    expect(captured.poll).toBeTruthy();

    await act(async () => { await captured.poll!(); });
    expect(screen.getByText('persona:p1')).toBeTruthy();
    expect(screen.getByTestId('cloud-history-liveness').getAttribute('data-stale')).toBe('false');

    // The orchestrator goes away. Before the fix the catch swallowed this, the
    // poller never backed off, and the indicator stayed "Live".
    listMock.mockRejectedValue(new Error('orchestrator unreachable'));
    let thrown: unknown = null;
    await act(async () => {
      try { await captured.poll!(); } catch (e) { thrown = e; }
    });
    expect(thrown).toBeInstanceOf(Error);
    // No empty snapshot: the previous rows are still the display.
    expect(screen.getByText('persona:p1')).toBeTruthy();
    expect(screen.getByTestId('cloud-history-liveness').getAttribute('data-stale')).toBe('true');

    // The next good poll clears the staleness.
    listMock.mockResolvedValue([exec]);
    await act(async () => { await captured.poll!(); });
    expect(screen.getByTestId('cloud-history-liveness').getAttribute('data-stale')).toBe('false');
  });
});
