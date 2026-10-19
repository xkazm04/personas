import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';

const listAllGoals = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  listAllGoals: (...a: unknown[]) => listAllGoals(...a),
}));
const storeState = { projects: [], fetchProjects: () => Promise.resolve() };
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
}));
vi.mock('../GoalDetailDrawer', () => ({ GoalDetailDrawer: () => null }));
vi.mock('../GoalEditorModal', () => ({ GoalEditorModal: () => null }));

import { useGoalsPortfolio } from '../progressShared';

const g = (id: string) => ({ id, project_id: 'p', status: 'open' }) as DevGoal;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => listAllGoals.mockReset());

describe('useGoalsPortfolio', () => {
  it('a refused read settles as failed, not as an endless load', async () => {
    listAllGoals.mockRejectedValueOnce({ error: 'db locked', kind: 'database' });
    const { result } = renderHook(() => useGoalsPortfolio('recent'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.allGoals).toBeNull();

    listAllGoals.mockResolvedValueOnce([g('a')]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.allGoals).toEqual([g('a')]));
    expect(result.current.failed).toBe(false);
  });

  it('an older read landing after a newer one does not overwrite it', async () => {
    const first = deferred<DevGoal[]>();
    const second = deferred<DevGoal[]>();
    listAllGoals.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ f }) => useGoalsPortfolio(f), {
      initialProps: { f: 'all' as 'all' | 'none' },
    });
    rerender({ f: 'none' });
    await act(async () => { second.resolve([g('live')]); });
    await act(async () => { first.resolve([g('live'), g('old-done')]); });
    expect(result.current.allGoals).toEqual([g('live')]);
  });
});
