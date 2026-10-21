import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const onFilterByRun = vi.fn();
vi.mock('@/features/teams/sub_teamMemory/useTeamMemories', () => ({
  useTeamMemories: () => ({ memories: [], stats: null, onFilterByRun }),
}));
vi.mock('@/features/teams/sub_teamMemory/components/diff/RunDiffView', () => ({ default: () => null }));
// Stub the timeline: only the props the Stream hands it matter here.
vi.mock('@/features/teams/sub_teamMemory/components/timeline/MemoryTimeline', () => ({
  default: (p: { onFilterRun: (id: string | null) => void; activeRunFilter: string | null }) => (
    <div>
      <span data-testid="active">{p.activeRunFilter ?? 'none'}</span>
      <button onClick={() => p.onFilterRun('run-1')}>filter</button>
      <button onClick={() => p.onFilterRun(null)}>clear</button>
    </div>
  ),
}));

import { StreamMemoryViews } from '../components/StreamMemoryViews';

describe('Stream memory timeline run filter', () => {
  it('tells the timeline which run is filtered so it can offer the clear control', () => {
    render(<StreamMemoryViews teamId="t1" mode="timeline" onExit={() => {}} />);
    expect(screen.getByTestId('active').textContent).toBe('none');
    fireEvent.click(screen.getByText('filter'));
    expect(onFilterByRun).toHaveBeenLastCalledWith('run-1');
    expect(screen.getByTestId('active').textContent).toBe('run-1');
    fireEvent.click(screen.getByText('clear'));
    expect(onFilterByRun).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('active').textContent).toBe('none');
  });
});
