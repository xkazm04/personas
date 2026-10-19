import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockList = vi.fn();
vi.mock('@/api/overview/reviews', () => ({
  listDesignReviewsPaginated: (...args: unknown[]) => mockList(...args),
  listReviewConnectors: vi.fn(async () => []),
  listReviewCategories: vi.fn(async () => []),
  getTrendingTemplates: vi.fn(async () => []),
  backfillReviewCategories: vi.fn(async () => {}),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: () => () => {},
  toastCatch: () => () => {},
}));

import { useGalleryQuery } from '../useGalleryQuery';
import { resolveError } from '@/lib/errors/errorRegistry';

const review = (id: string) => ({ id, adoption_count: 0, connectors_used: null });
const pageOf = (ids: string[], total: number) => ({ items: ids.map(review), total });

const pagesRequested = () => mockList.mock.calls.map((c) => (c[0] as { page: number }).page);

beforeEach(() => mockList.mockReset());

describe('useGalleryQuery failures', () => {
  it('a rejected page-0 fetch exposes an error, and a later success clears it', async () => {
    mockList.mockRejectedValueOnce(new Error('DB busy'));
    const hook = renderHook(() => useGalleryQuery());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.error).toBe(resolveError('DB busy').message);
    expect(hook.result.current.error).not.toBe('DB busy');
    expect(hook.result.current.items).toEqual([]);

    mockList.mockResolvedValueOnce(pageOf(['a'], 1));
    await act(async () => {
      hook.result.current.refresh();
    });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect(hook.result.current.error).toBeNull();
  });

  it('resolves an IPC AppError rejection by its message, not by "[object Object]"', async () => {
    // invokeWithTimeout rejects with the serialized AppError envelope, never an Error.
    mockList.mockRejectedValueOnce({ error: 'Network offline: no route to host', kind: 'NetworkOffline' });
    const hook = renderHook(() => useGalleryQuery());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.error).toBe(resolveError('Network offline: no route to host').message);
    expect(hook.result.current.error).not.toBe(resolveError('[object Object]').message);
  });

  it('a failed fetchMore does not skip its page: the next fetchMore asks for the same page again', async () => {
    mockList.mockResolvedValueOnce(pageOf(['a'], 3)); // page 0
    const hook = renderHook(() => useGalleryQuery());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));

    mockList.mockRejectedValueOnce(new Error('transient')); // page 1 fails
    await act(async () => {
      hook.result.current.fetchMore();
    });
    await waitFor(() => expect(hook.result.current.isFetchingMore).toBe(false));
    expect(hook.result.current.error).toBe(resolveError('transient').message);

    mockList.mockResolvedValueOnce(pageOf(['b'], 3)); // retry of page 1
    await act(async () => {
      hook.result.current.fetchMore();
    });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2));
    expect(pagesRequested().slice(0, 3)).toEqual([0, 1, 1]);
    expect(hook.result.current.error).toBeNull();
  });
});
