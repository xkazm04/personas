import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { mockFetchTeams, store } = vi.hoisted(() => ({
  mockFetchTeams: vi.fn(),
  store: { teams: [] as Array<{ id: string; name: string; color: string | null }> },
}));

vi.mock('@/stores/pipelineStore', () => {
  const state = () => ({ teams: store.teams, fetchTeams: mockFetchTeams });
  const usePipelineStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  return { usePipelineStore };
});

import { PersonaOverviewBatchBar } from '../PersonaOverviewBatchBar';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  mockFetchTeams.mockReset().mockResolvedValue(undefined);
  store.teams = [];
});

describe('PersonaOverviewBatchBar', () => {
  it('does not fetch teams on mount, even when the move action is available', () => {
    render(<PersonaOverviewBatchBar count={0} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}} />);
    expect(mockFetchTeams).not.toHaveBeenCalled();
  });

  it('fetches teams the first time the move menu opens and the store is empty', () => {
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}} />);
    expect(mockFetchTeams).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /set home team/i }));
    expect(mockFetchTeams).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when teams are already loaded', () => {
    store.teams = [{ id: 't1', name: 'Alpha', color: null }];
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /set home team/i }));
    expect(mockFetchTeams).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: /alpha/i })).toBeTruthy();
  });

  it('fires archive once for two clicks while the first is in flight', async () => {
    const gate = deferred();
    const onArchive = vi.fn(() => gate.promise);
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onArchive={onArchive} />);
    const btn = screen.getByRole('button', { name: /archive/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => { gate.resolve(); await gate.promise; });
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });

  it('fires restore once for two clicks while the first is in flight', async () => {
    const gate = deferred();
    const onRestore = vi.fn(() => gate.promise);
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onRestore={onRestore} />);
    const btn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onRestore).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await gate.promise; });
  });
});
