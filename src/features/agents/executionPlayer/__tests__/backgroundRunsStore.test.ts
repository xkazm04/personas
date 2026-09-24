/**
 * Store half of the background runs lane (scan-sweep challenge-2026-09-23,
 * agents-deployment-B). Uses the REAL agent store and mocks only the IPC door.
 *
 * The backend's verify_execution_owner rejects a cancel whose caller persona
 * does not own the run, so a background run must be cancelled with ITS OWN
 * persona, never the focused one, and without touching foreground state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cancelExecution } = vi.hoisted(() => ({ cancelExecution: vi.fn() }));
vi.mock('@/api/agents/executions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/executions')>()),
  cancelExecution,
}));

import { useAgentStore } from '@/stores/agentStore';

beforeEach(() => {
  cancelExecution.mockReset();
  cancelExecution.mockResolvedValue(undefined);
  useAgentStore.setState({
    activeExecutionId: 'a1',
    executionPersonaId: 'p1',
    isExecuting: true,
    backgroundExecutions: [
      {
        executionId: 'bg1',
        personaId: 'p2',
        personaName: 'Second',
        personaColor: '#123456',
        status: 'running',
        startedAt: '2026-09-24T10:00:00.000Z',
      },
    ],
  });
});

describe('cancelBackgroundExecution', () => {
  it("case 4: cancels with the run's own persona and leaves the focused run alone", async () => {
    await useAgentStore.getState().cancelBackgroundExecution('bg1');

    expect(cancelExecution).toHaveBeenCalledWith('bg1', 'p2');
    const bg = useAgentStore.getState().backgroundExecutions.find((b) => b.executionId === 'bg1');
    expect(bg?.status).toBe('cancelled');
    expect(typeof bg?.terminalAt).toBe('string');
    expect(useAgentStore.getState().activeExecutionId).toBe('a1');
    expect(useAgentStore.getState().isExecuting).toBe(true);
  });
});

describe('cancelExecution (foreground)', () => {
  it('[guard] case 7: still cancels with the focused persona', async () => {
    await useAgentStore.getState().cancelExecution('a1');
    expect(cancelExecution).toHaveBeenCalledWith('a1', 'p1');
  });
});
