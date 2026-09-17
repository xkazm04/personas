import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { UseCaseItem } from '../UseCasesList';

vi.mock('@/api/agents/useCases', () => ({ simulateUseCase: vi.fn(async () => ({ id: 'x' })) }));
vi.mock('@/hooks/execution/usePersonaExecution', () => ({
  usePersonaExecution: () => ({ disconnect: () => {} }),
}));

import { useUseCaseExecution } from '../useUseCaseExecution';
import { useAgentStore } from '@/stores/agentStore';
import { simulateUseCase as simulateUseCaseRaw } from '@/api/agents/useCases';

const simulateUseCase = vi.mocked(simulateUseCaseRaw);

const useCase = {
  id: 'uc1',
  title: 'Triage tickets',
  description: 'triage',
  execution_mode: 'e2e',
  sample_input: { subject: 'hi' },
} as unknown as UseCaseItem;

describe('useUseCaseExecution simulate path', () => {
  const executePersona = vi.fn(async () => {});

  beforeEach(() => {
    simulateUseCase.mockClear();
    executePersona.mockClear();
    useAgentStore.setState({ executePersona } as never);
  });

  it('Simulate invokes simulateUseCase and never the real run', async () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useUseCaseExecution('p1', useCase, onFinished));
    await act(async () => { await result.current.handleSimulate(); });
    expect(simulateUseCase).toHaveBeenCalledTimes(1);
    expect(simulateUseCase.mock.calls[0]?.slice(0, 2)).toEqual(['p1', 'uc1']);
    expect(executePersona).not.toHaveBeenCalled();
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
  });

  it('Execute still takes the real, side-effecting path', async () => {
    const { result } = renderHook(() => useUseCaseExecution('p1', useCase));
    await act(async () => { await result.current.handleExecute(); });
    expect(executePersona).toHaveBeenCalledTimes(1);
    expect(simulateUseCase).not.toHaveBeenCalled();
  });
});
