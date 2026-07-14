import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const listExecutions = vi.fn();

vi.mock('@/api/agents/executions', () => ({
  listExecutions: (...args: unknown[]) => listExecutions(...args),
}));

// Overview store is only read for the health signal; a stable empty array keeps
// the selector pure across renders.
vi.mock('@/stores/overviewStore', () => {
  const state = { healthSignals: [] as unknown[] };
  const hook = (selector: (s: typeof state) => unknown) => selector(state);
  return { useOverviewStore: hook };
});

import { storeBus } from '@/lib/storeBus';
import { useQuickStats } from '../useQuickStats';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  persona_id: 'p1',
  status: 'completed',
  duration_ms: 1200,
  cost_usd: 0.02,
  started_at: '2026-07-14T00:00:00Z',
  created_at: '2026-07-14T00:00:00Z',
  ...over,
});

beforeEach(() => {
  listExecutions.mockReset();
  listExecutions.mockResolvedValue([row()]);
  storeBus._reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useQuickStats', () => {
  it('fetches once on mount', async () => {
    renderHook(() => useQuickStats('p1'));
    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(1));
    expect(listExecutions).toHaveBeenCalledWith('p1', 50);
  });

  it('refetches exactly once when a matching execution:completed fires', async () => {
    renderHook(() => useQuickStats('p1'));
    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(1));

    await act(async () => {
      storeBus.emit('execution:completed', { personaId: 'p1' });
      // Wait past the coalescing debounce window.
      await new Promise((r) => setTimeout(r, 450));
    });

    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(2));
  });

  it('coalesces a burst of completions into a single refetch', async () => {
    renderHook(() => useQuickStats('p1'));
    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(1));

    await act(async () => {
      storeBus.emit('execution:completed', { personaId: 'p1' });
      storeBus.emit('execution:completed', { personaId: 'p1' });
      storeBus.emit('execution:completed', { personaId: 'p1' });
      await new Promise((r) => setTimeout(r, 450));
    });

    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(2));
  });

  it('ignores completions for other personas', async () => {
    renderHook(() => useQuickStats('p1'));
    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(1));

    await act(async () => {
      storeBus.emit('execution:completed', { personaId: 'other' });
      await new Promise((r) => setTimeout(r, 450));
    });

    // Still only the mount fetch.
    expect(listExecutions).toHaveBeenCalledTimes(1);
  });
});
