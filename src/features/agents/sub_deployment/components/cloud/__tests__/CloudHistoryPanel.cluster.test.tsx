import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CloudExecution, CloudExecutionStats } from '@/api/system/cloud';

const executions: CloudExecution[] = [
  {
    id: 'e1', personaId: 'p1', projectId: null, status: 'failed',
    inputData: null, errorMessage: 'rate limited by provider', durationMs: null,
    costUsd: null, inputTokens: null, outputTokens: null, retryCount: null,
    startedAt: null, completedAt: null, createdAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'e2', personaId: 'p1', projectId: null, status: 'failed',
    inputData: null, errorMessage: 'connection timeout', durationMs: null,
    costUsd: null, inputTokens: null, outputTokens: null, retryCount: null,
    startedAt: null, completedAt: null, createdAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'e3', personaId: 'p1', projectId: null, status: 'completed',
    inputData: null, errorMessage: null, durationMs: null,
    costUsd: null, inputTokens: null, outputTokens: null, retryCount: null,
    startedAt: null, completedAt: null, createdAt: '2026-09-01T00:00:00Z',
  },
];

const stats: CloudExecutionStats = {
  totalExecutions: 3n, completed: 1n, failed: 2n, cancelled: 0n,
  successRate: 0.33, totalCostUsd: 0, avgCostUsd: null, avgDurationMs: null,
  dailyBreakdown: [],
  topErrors: [
    { message: 'rate limited by provider', count: 9n },
    { message: 'connection timeout', count: 2n },
  ],
};

vi.mock('@/api/system/cloud', () => ({
  cloudListExecutions: vi.fn(async () => executions),
  cloudExecutionStats: vi.fn(async () => stats),
  cloudGetExecutionOutput: vi.fn(async () => []),
}));

// Stand in for the real poller: fire one fetch on mount, then stay quiet, so
// the panel paints a single deterministic snapshot.
vi.mock('@/hooks/utility/timing/usePolling', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    usePolling: (fn: () => unknown) => {
      const ref = useRef(fn);
      ref.current = fn;
      useEffect(() => {
        void ref.current();
      }, []);
      return { lastRefreshed: null };
    },
    POLLING_CONFIG: { cloudHistory: {} },
  };
});

import { CloudHistoryPanel } from '../CloudHistoryPanel';
import { useAgentStore } from '@/stores/agentStore';

describe('CloudHistoryPanel top-error drill-down', () => {
  beforeEach(() => {
    useAgentStore.setState({ personas: [] });
  });

  async function renderPanel() {
    render(<CloudHistoryPanel />);
    await waitFor(() => expect(screen.getAllByTestId('cloud-top-error').length).toBe(2));
    await waitFor(() => expect(screen.getAllByTestId('cloud-execution-row').length).toBe(3));
  }

  it('narrows the execution list to the clicked cluster', async () => {
    await renderPanel();
    fireEvent.click(screen.getAllByTestId('cloud-top-error')[0]);
    await waitFor(() => expect(screen.getAllByTestId('cloud-execution-row').length).toBe(1));
    expect(screen.getByTestId('cloud-error-cluster-chip')).toBeTruthy();
  });

  it('restores the full list when the chip is cleared', async () => {
    await renderPanel();
    fireEvent.click(screen.getAllByTestId('cloud-top-error')[0]);
    await waitFor(() => expect(screen.getAllByTestId('cloud-execution-row').length).toBe(1));
    fireEvent.click(screen.getAllByTestId('cloud-top-error')[0]);
    await waitFor(() => expect(screen.getAllByTestId('cloud-execution-row').length).toBe(3));
    expect(screen.queryByTestId('cloud-error-cluster-chip')).toBeNull();
  });
});
