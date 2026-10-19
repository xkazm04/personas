import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import type { TeamMemory } from '@/lib/bindings/TeamMemory';

vi.mock('@/api/pipeline/teamMemories', () => ({
  listTeamMemories: vi.fn(),
  getTeamMemoryCount: vi.fn(),
  getTeamMemoryStats: vi.fn().mockResolvedValue(null),
  createTeamMemory: vi.fn(),
  deleteTeamMemory: vi.fn(),
  updateTeamMemory: vi.fn(),
  updateTeamMemoryImportance: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

import * as api from '@/api/pipeline/teamMemories';
import { useTeamMemories } from '../useTeamMemories';

const mem = (id: string): TeamMemory => ({
  id, team_id: 'team-1', run_id: null, member_id: null, persona_id: null,
  title: id, content: id, category: 'observation', importance: 3, tags: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as TeamMemory);

const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => mem(`m${from + i}`));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * `onLoadMore` is an APPEND to the current list, not a new list. It used to
 * mint its own list-wins token, which superseded the refresh whose count and
 * stats were still in flight: those then dropped as stale and `total` stayed
 * at the previous filter's value, so "load more" and "showing N of M" kept
 * describing a list the operator had already narrowed away from.
 */
describe('useTeamMemories: paging against an in-flight count', () => {
  beforeEach(() => {
    vi.mocked(api.listTeamMemories).mockReset();
    vi.mocked(api.getTeamMemoryCount).mockReset();
  });

  it('a load-more while the count is in flight does not orphan the count', async () => {
    const count = deferred<number>();
    vi.mocked(api.listTeamMemories)
      .mockResolvedValueOnce(page(0, 30))
      .mockResolvedValueOnce(page(30, 15));
    vi.mocked(api.getTeamMemoryCount).mockReturnValueOnce(count.promise);

    const { result } = renderHook(() => useTeamMemories('team-1'));
    await waitFor(() => expect(result.current.memories).toHaveLength(30));

    await act(async () => { await result.current.onLoadMore(); });
    expect(result.current.memories).toHaveLength(45);

    await act(async () => { count.resolve(45); await count.promise; });
    await waitFor(() => expect(result.current.total).toBe(45));
  });

  it('a page that lands after a newer filter refetch is still dropped', async () => {
    const more = deferred<TeamMemory[]>();
    vi.mocked(api.getTeamMemoryCount).mockResolvedValue(60);
    vi.mocked(api.listTeamMemories)
      .mockResolvedValueOnce(page(0, 30))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(page(100, 5));

    const { result } = renderHook(() => useTeamMemories('team-1'));
    await waitFor(() => expect(result.current.total).toBe(60));

    let loading!: Promise<void>;
    act(() => { loading = result.current.onLoadMore(); });
    act(() => { result.current.onFilter('decision'); });
    await waitFor(() => expect(result.current.memories.map((m) => m.id)).toEqual(page(100, 5).map((m) => m.id)));

    await act(async () => { more.resolve(page(30, 30)); await loading; });
    expect(result.current.memories).toHaveLength(5);
  });
});
