/**
 * WHAT A CLOUD POLL THAT FOUND NOTHING COSTS THE ACTIVITY BOARD.
 *
 * `fetchCloudReviews` runs every 15 seconds and used to `set` a freshly built
 * array every single time — including on the two paths that set a literal
 * `[]`. That identity is load-bearing a long way downstream: `useMonitorData`
 * folds `cloudReviews` into `reviews`, and `reviews` is one of the seven deps
 * of the Activity board's `buildMonitorModel` memo. So an install with no
 * cloud connection at all, or with the same two reviews it had a minute ago,
 * rebuilt and re-sorted every card on the board four times a minute.
 *
 * These tests measure the ARRAY IDENTITY, because that is the thing the memo
 * keys on. A deep-equality assertion would have passed the whole time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudListPendingReviews = vi.fn();

vi.mock('@/api/system/cloud', () => ({
  cloudListPendingReviews: (...a: unknown[]) => cloudListPendingReviews(...a),
  cloudRespondToReview: vi.fn(),
}));

import { create } from 'zustand';
import { storeBus, AccessorKey } from '@/lib/storeBus';
import { createOverviewSlice } from '../overviewSlice';
import type { OverviewStore } from '../../../storeTypes';

function makeStore() {
  return create<OverviewStore>()((...a) => ({
    ...createOverviewSlice(...a),
  }) as OverviewStore);
}

/** A row shaped the way `cloud_list_pending_reviews` returns one. */
function cloudRow(reviewId: string) {
  return {
    reviewId,
    personaId: 'p1',
    executionId: 'e1',
    status: 'pending',
    payload: JSON.stringify({ title: `Review ${reviewId}`, content: 'body' }),
    responseMessage: null,
    createdAt: 1_700_000_000,
    resolvedAt: null,
  };
}

function connected(is: boolean) {
  storeBus.provide(AccessorKey.SYSTEM_CLOUD_CONFIG, () => ({ is_connected: is }));
}

describe('fetchCloudReviews — an unchanged answer keeps the array', () => {
  beforeEach(() => {
    cloudListPendingReviews.mockReset();
  });

  it('keeps the SAME empty array when there is no cloud connection', async () => {
    connected(false);
    const store = makeStore();

    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;
    await store.getState().fetchCloudReviews();

    expect(store.getState().cloudReviews).toBe(first);
    expect(cloudListPendingReviews).not.toHaveBeenCalled();
  });

  it('keeps the SAME array across two polls that return the same rows', async () => {
    connected(true);
    cloudListPendingReviews.mockResolvedValue([cloudRow('c1'), cloudRow('c2')]);
    const store = makeStore();

    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;
    expect(first).toHaveLength(2);

    await store.getState().fetchCloudReviews();
    expect(store.getState().cloudReviews).toBe(first);
  });

  it('keeps the SAME empty array across two polls that return nothing', async () => {
    connected(true);
    cloudListPendingReviews.mockResolvedValue([]);
    const store = makeStore();

    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;

    await store.getState().fetchCloudReviews();
    expect(store.getState().cloudReviews).toBe(first);
  });

  it('keeps the SAME array when the read FAILS and the list was already empty', async () => {
    connected(true);
    cloudListPendingReviews.mockResolvedValueOnce([]);
    const store = makeStore();
    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;

    cloudListPendingReviews.mockRejectedValueOnce(new Error('offline'));
    await store.getState().fetchCloudReviews();

    expect(store.getState().cloudReviews).toBe(first);
  });
});

describe('the bail-out is a cache, not a freeze', () => {
  beforeEach(() => {
    cloudListPendingReviews.mockReset();
    connected(true);
  });

  it('hands back a NEW array when a cloud review arrives', async () => {
    cloudListPendingReviews.mockResolvedValueOnce([cloudRow('c1')]);
    const store = makeStore();
    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;

    cloudListPendingReviews.mockResolvedValueOnce([cloudRow('c1'), cloudRow('c2')]);
    await store.getState().fetchCloudReviews();

    expect(store.getState().cloudReviews).not.toBe(first);
    expect(store.getState().cloudReviews).toHaveLength(2);
  });

  it('hands back a NEW array when a cloud review is resolved elsewhere', async () => {
    cloudListPendingReviews.mockResolvedValueOnce([cloudRow('c1')]);
    const store = makeStore();
    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;

    cloudListPendingReviews.mockResolvedValueOnce([]);
    await store.getState().fetchCloudReviews();

    expect(store.getState().cloudReviews).not.toBe(first);
    expect(store.getState().cloudReviews).toHaveLength(0);
  });

  it('hands back a NEW array when a row CHANGES without the count moving', async () => {
    cloudListPendingReviews.mockResolvedValueOnce([cloudRow('c1')]);
    const store = makeStore();
    await store.getState().fetchCloudReviews();
    const first = store.getState().cloudReviews;

    const edited = { ...cloudRow('c1'), payload: JSON.stringify({ title: 'Renamed', content: 'elsewhere' }) };
    cloudListPendingReviews.mockResolvedValueOnce([edited]);
    await store.getState().fetchCloudReviews();

    expect(store.getState().cloudReviews).not.toBe(first);
    expect(store.getState().cloudReviews[0]!.content).not.toBe(first[0]!.content);
  });
});
