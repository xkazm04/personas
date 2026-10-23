/**
 * The memory slice keeps the backend's reason for a failed read or review.
 * IPC rejects with a serialized AppError OBJECT, which the old
 * `err instanceof Error ? err.message : String(err)` turned into
 * "[object Object]", so the Memories banner could only say something generic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMemoriesWithStats = vi.fn();
const reviewMemoriesWithCli = vi.fn();
const reflectMemoriesWithCli = vi.fn();

vi.mock('@/api/overview/memories', () => ({
  listMemoriesWithStats: (...a: unknown[]) => listMemoriesWithStats(...a),
  reviewMemoriesWithCli: (...a: unknown[]) => reviewMemoriesWithCli(...a),
  reflectMemoriesWithCli: (...a: unknown[]) => reflectMemoriesWithCli(...a),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  mergeMemoriesAtomic: vi.fn(),
  updateMemoryTier: vi.fn(),
}));

import { create } from 'zustand';
import { createMemorySlice } from '../memorySlice';
import type { OverviewStore } from '../../../storeTypes';

function makeStore() {
  return create<OverviewStore>()((...a) => ({
    error: null,
    errorKind: null,
    ...createMemorySlice(...a),
  }) as OverviewStore);
}

const APP_ERROR = { error: 'Database error: database is locked', kind: 'Database' };

beforeEach(() => {
  listMemoriesWithStats.mockReset();
  reviewMemoriesWithCli.mockReset();
  reflectMemoriesWithCli.mockReset();
});

describe('memorySlice error text', () => {
  it('a failed read keeps the AppError text', async () => {
    listMemoriesWithStats.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    await store.getState().fetchMemories();
    expect(store.getState().memoriesError).toBe('Database error: database is locked');
  });

  it('a failed review keeps the AppError text', async () => {
    reviewMemoriesWithCli.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    await expect(store.getState().reviewMemories()).rejects.toBe(APP_ERROR);
    expect(store.getState().memoryReviewError).toBe('Database error: database is locked');
  });

  it('a failed reflection keeps the AppError text', async () => {
    reflectMemoriesWithCli.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    await expect(store.getState().reflectMemories('p1')).rejects.toBe(APP_ERROR);
    expect(store.getState().memoryReviewError).toBe('Database error: database is locked');
  });
});
