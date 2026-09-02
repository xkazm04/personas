import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- API mocks --------------------------------------------------------------
const listAllExecutions = vi.fn();
const countExecutions = vi.fn();

vi.mock('@/api/agents/executions', () => ({
  listAllExecutions: (...a: unknown[]) => listAllExecutions(...a),
  countExecutions: (...a: unknown[]) => countExecutions(...a),
}));

import { create } from 'zustand';
import { createOverviewSlice } from '../overviewSlice';
import type { OverviewStore } from '../../../storeTypes';
import type { GlobalExecutionListItem } from '@/lib/bindings/GlobalExecutionListItem';

function row(id: string): GlobalExecutionListItem {
  return {
    id,
    personaId: 'p-1',
    status: 'completed',
    modelUsed: null,
    thinkingLevel: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    durationMs: null,
    startedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    personaName: 'Agent',
    personaIcon: null,
    personaColor: null,
  };
}

function page(from: number, count: number): GlobalExecutionListItem[] {
  return Array.from({ length: count }, (_, i) => row(`e-${from + i}`));
}

/** The slice under test, standing alone — `fetchGlobalExecutions` only ever
 *  reads and writes its own fields. */
function makeStore() {
  return create<OverviewStore>()((...a) => ({
    ...createOverviewSlice(...a),
  }) as OverviewStore);
}

describe('overviewSlice — global execution paging', () => {
  beforeEach(() => {
    listAllExecutions.mockReset();
    countExecutions.mockReset();
  });

  it('asks for the first page at offset 0', async () => {
    listAllExecutions.mockResolvedValue(page(0, 50));
    const store = makeStore();

    await store.getState().fetchGlobalExecutions(true);

    expect(listAllExecutions).toHaveBeenCalledWith(50, 0, undefined, undefined);
    expect(store.getState().globalExecutions).toHaveLength(50);
    expect(store.getState().globalExecutionsOffset).toBe(50);
    expect(store.getState().globalExecutionsHasMore).toBe(true);
  });

  it('pages forward with an OFFSET and APPENDS, instead of refetching from row 0', async () => {
    const store = makeStore();
    listAllExecutions.mockResolvedValueOnce(page(0, 50));
    await store.getState().fetchGlobalExecutions(true);

    listAllExecutions.mockResolvedValueOnce(page(50, 50));
    await store.getState().fetchGlobalExecutions(false);

    // The whole point: the second request asks for ONE page starting where the
    // list ends. The old code asked for limit=100 at offset 0 — 150 rows
    // transferred to show 100, and 500 rows cost 2,750.
    expect(listAllExecutions).toHaveBeenNthCalledWith(2, 50, 50, undefined, undefined);
    const ids = store.getState().globalExecutions.map((r) => r.id);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('e-0');
    expect(ids[99]).toBe('e-99');
    expect(new Set(ids).size).toBe(100);
  });

  it('drops a row the server repeats across pages rather than double-counting it', async () => {
    const store = makeStore();
    listAllExecutions.mockResolvedValueOnce(page(0, 50));
    await store.getState().fetchGlobalExecutions(true);

    // A run landing between the two requests shifts the window, so page 2
    // legitimately starts with a row page 1 already carried.
    listAllExecutions.mockResolvedValueOnce([row('e-49'), ...page(50, 49)]);
    await store.getState().fetchGlobalExecutions(false);

    const ids = store.getState().globalExecutions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 'e-49')).toHaveLength(1);
  });

  it('a reset refetches the window already on screen — one request, from row 0', async () => {
    const store = makeStore();
    listAllExecutions.mockResolvedValueOnce(page(0, 50));
    await store.getState().fetchGlobalExecutions(true);
    listAllExecutions.mockResolvedValueOnce(page(50, 50));
    await store.getState().fetchGlobalExecutions(false);

    listAllExecutions.mockResolvedValueOnce(page(0, 100));
    await store.getState().fetchGlobalExecutions(true, 'failed');

    // 100 rows are on screen, so the poll re-reads 100 — it does not collapse
    // the list back to one page, and it does not climb a ladder to get there.
    expect(listAllExecutions).toHaveBeenNthCalledWith(3, 100, 0, 'failed', undefined);
    expect(store.getState().globalExecutions).toHaveLength(100);
  });

  it('stops offering more once the loaded window reaches the cap', async () => {
    const store = makeStore();
    listAllExecutions.mockResolvedValueOnce(page(0, 50));
    await store.getState().fetchGlobalExecutions(true);
    for (let p = 1; p < 10; p += 1) {
      listAllExecutions.mockResolvedValueOnce(page(p * 50, 50));
      await store.getState().fetchGlobalExecutions(false);
    }

    // 10 pages = the 500-row cap. The server would still have more, but the
    // list stops asking rather than growing without a bound.
    expect(store.getState().globalExecutions).toHaveLength(500);
    expect(store.getState().globalExecutionsHasMore).toBe(false);
    expect(listAllExecutions).toHaveBeenLastCalledWith(50, 450, undefined, undefined);
  });
});
