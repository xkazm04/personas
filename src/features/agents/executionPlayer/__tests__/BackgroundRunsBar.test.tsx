/**
 * The lane wiring: a background run chip opens its actions, and Stop reaches
 * the IPC with the run's own persona (scan-sweep challenge-2026-09-23,
 * agents-deployment-B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { cancelExecution } = vi.hoisted(() => ({ cancelExecution: vi.fn() }));
vi.mock('@/api/agents/executions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/executions')>()),
  cancelExecution,
}));

import { useAgentStore } from '@/stores/agentStore';
import { BackgroundRunsBar } from '../BackgroundRunsBar';

const lane = (executionId: string, status: 'running' | 'failed') => ({
  executionId,
  personaId: `p-${executionId}`,
  personaName: `Agent ${executionId}`,
  personaColor: '#123456',
  status,
  startedAt: '2026-09-24T10:00:00.000Z',
  terminalAt: status === 'failed' ? '2026-09-24T10:01:00.000Z' : undefined,
});

beforeEach(() => {
  cancelExecution.mockReset();
  cancelExecution.mockResolvedValue(undefined);
  useAgentStore.setState({ activeExecutionId: 'a1', executionPersonaId: 'p1', backgroundExecutions: [lane('bg1', 'running'), lane('bg2', 'failed')] });
});

describe('BackgroundRunsBar', () => {
  it('stops a running lane with its own persona', async () => {
    render(<BackgroundRunsBar />);
    fireEvent.click(screen.getByTestId('background-run-bg1'));
    expect(screen.queryByTestId('background-run-dismiss')).toBeNull();
    fireEvent.click(screen.getByTestId('background-run-stop'));
    await waitFor(() => expect(cancelExecution).toHaveBeenCalledWith('bg1', 'p-bg1'));
  });

  it('dismisses a failed lane, which offers no Stop', () => {
    render(<BackgroundRunsBar />);
    fireEvent.click(screen.getByTestId('background-run-bg2'));
    expect(screen.queryByTestId('background-run-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('background-run-dismiss'));
    expect(useAgentStore.getState().backgroundExecutions.map((b) => b.executionId)).toEqual(['bg1']);
  });
});
