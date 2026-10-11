import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import ExecutionMiniPlayer from '../ExecutionMiniPlayer';

vi.mock('@/hooks/utility/interaction/useTier', () => ({ useTier: () => ({ isStarter: true }) }));
vi.mock('@/hooks/execution/useReasoningTrace', () => ({ useReasoningTrace: () => ({ entries: [], isLive: false }) }));
vi.mock('@/hooks/execution/useExecutionSummary', () => ({ useExecutionSummary: () => null }));
vi.mock('@/hooks/execution/useExecutionScope', () => ({ useExecutionScope: () => undefined }));
vi.mock('../BackgroundRunsBar', () => ({ BackgroundRunsBar: () => null }));

function renderFinished(status: 'failed' | 'completed', agentError: string | null, systemError: string | null) {
  useAgentStore.setState({
    miniPlayerPinned: true,
    miniPlayerPosition: { x: 0, y: 0 },
    isExecuting: false,
    executionOutput: ['run output'],
    executionMeaningfulTail: ['run output'],
    lastExecutionId: 'run-1',
    executions: [{ id: 'run-1', status } as never],
    error: agentError,
  });
  useSystemStore.setState({ error: systemError });
  return render(<ExecutionMiniPlayer />);
}

afterEach(() => {
  act(() => {
    useAgentStore.setState({ miniPlayerPinned: false, executionOutput: [], lastExecutionId: null, executions: [], error: null });
    useSystemStore.setState({ error: null });
  });
});

describe('ExecutionMiniPlayer terminal verdict', () => {
  it('shows a failed run as failed when the system store has no error', () => {
    renderFinished('failed', 'run failed', null);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('keeps a completed run complete despite an unrelated system error', () => {
    renderFinished('completed', null, 'unrelated system failure');
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
