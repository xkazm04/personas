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

  it('dismisses the home-team menu on an outside press or Escape, not an inside one', () => {
    store.teams = [{ id: 't1', name: 'Alpha', color: null }];
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}} />);
    const trigger = screen.getByRole('button', { name: /set home team/i });
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
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
    // The shared Button drops aria-busy when idle (absent = not busy).
    expect(btn.getAttribute('aria-busy')).not.toBe('true');
  });

  it('fires archive once for three clicks dispatched without a render between them', async () => {
    // The discriminating case: fireEvent flushes a render between calls, so the
    // two-click test above passes even against a guard that only reads React
    // state. Dispatching three native clicks on the same element in one act()
    // block does not, and only the synchronous in-flight ref survives it.
    const d = deferred();
    const onArchive = vi.fn(() => d.promise);
    render(<PersonaOverviewBatchBar count={3} onDelete={() => {}} onClear={() => {}} onArchive={onArchive} />);
    const btn = screen.getByRole('button', { name: /archive/i });
    const ev = () => new MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev());
    btn.dispatchEvent(ev());
    btn.dispatchEvent(ev());
    expect(onArchive).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  // Round 2 card 9: the team menu declared role="menu" but never moved focus
  // into itself and answered no arrow key.
  it('moves focus into the team menu, answers arrows, and returns focus on Escape', () => {
    store.teams = [{ id: 't1', name: 'Alpha', color: null }, { id: 't2', name: 'Beta', color: null }];
    render(<PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}} />);
    const trigger = screen.getByRole('button', { name: /set home team/i });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // Round 2 card 11: five of the bar's six controls were hand-rolled buttons
  // painted with raw palette classes beside the shared Button family.
  it('paints every bar control through the shared Button family, Delete as danger', () => {
    render(
      <PersonaOverviewBatchBar count={2} onDelete={() => {}} onClear={() => {}} onMoveToGroup={async () => {}}
        onArchive={async () => {}} onDuplicate={async () => {}} />,
    );
    const raw = /text-(indigo|amber|emerald)-300|text-red-400/;
    for (const btn of screen.getAllByRole('button')) expect(btn.className).not.toMatch(raw);
    expect(screen.getByRole('button', { name: /^delete$/i }).className).toMatch(/bg-red-600/);
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
