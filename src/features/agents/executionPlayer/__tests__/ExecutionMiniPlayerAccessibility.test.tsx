import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import ExecutionMiniPlayer from '../ExecutionMiniPlayer';

vi.mock('@/hooks/utility/interaction/useTier', () => ({ useTier: () => ({ isStarter: false }) }));
vi.mock('@/hooks/execution/useReasoningTrace', () => ({ useReasoningTrace: () => ({ entries: [], isLive: false }) }));
vi.mock('@/hooks/execution/useExecutionSummary', () => ({ useExecutionSummary: () => null }));
vi.mock('@/hooks/execution/useExecutionScope', () => ({ useExecutionScope: () => undefined }));
vi.mock('../BackgroundRunsBar', () => ({ BackgroundRunsBar: () => null }));

afterEach(() => {
  act(() => useAgentStore.setState({ miniPlayerPinned: false, miniPlayerExpanded: false, isExecuting: false, activeExecutionId: null }));
});

describe('ExecutionMiniPlayer icon controls', () => {
  it('names Stop, Expand/Collapse, and Unpin for assistive technology', () => {
    useAgentStore.setState({
      miniPlayerPinned: true, miniPlayerExpanded: false, miniPlayerPosition: { x: 0, y: 0 },
      isExecuting: true, activeExecutionId: 'run-1', executionPersonaId: null,
    });
    render(<ExecutionMiniPlayer />);

    expect(screen.getByRole('button', { name: 'Stop execution' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin mini-player' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });
});
