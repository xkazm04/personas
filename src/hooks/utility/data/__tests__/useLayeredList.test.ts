import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLayeredList, type LayeredPage } from '../useLayeredList';

// jsdom has no IntersectionObserver — stub a no-op so `sentinelRef` is safe
// to attach during these (sentinel-free) tests.
beforeEach(() => {
  (globalThis as Record<string, unknown>).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };
});

function page(rows: number[], hasMore: boolean): LayeredPage<number> {
  return {
    rows,
    nextCursor: hasMore ? `c${rows[rows.length - 1]}` : null,
    hasMore,
  };
}

describe('useLayeredList', () => {
  it('loads L0 counts and L1 first page on mount', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([1, 2, 3], true));
    const fetchCounts = vi.fn().mockResolvedValue({ total: 99 });

    const { result } = renderHook(() =>
      useLayeredList<number, { total: number }>({ filterKey: 'all', fetchPage, fetchCounts }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([1, 2, 3]);
    expect(result.current.counts).toEqual({ total: 99 });
    expect(result.current.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it('appends the next keyset page on loadMore', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], true))
      .mockResolvedValueOnce(page([3, 4], false));

    const { result } = renderHook(() => useLayeredList<number>({ filterKey: 'all', fetchPage }));
    await waitFor(() => expect(result.current.rows).toEqual([1, 2]));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toEqual([1, 2, 3, 4]));

    expect(result.current.hasMore).toBe(false);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'c2');
  });

  it('resets and refetches when filterKey changes', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], false))
      .mockResolvedValueOnce(page([9], false));

    const { result, rerender } = renderHook(
      ({ k }) => useLayeredList<number>({ filterKey: k, fetchPage }),
      { initialProps: { k: 'pending' } },
    );
    await waitFor(() => expect(result.current.rows).toEqual([1, 2]));

    rerender({ k: 'approved' });
    await waitFor(() => expect(result.current.rows).toEqual([9]));
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('drops a stale first-page response superseded by a filter change', async () => {
    let resolveSlow: (p: LayeredPage<number>) => void = () => {};
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<LayeredPage<number>>((res) => { resolveSlow = res; }),
      )
      .mockResolvedValueOnce(page([42], false));

    const { result, rerender } = renderHook(
      ({ k }) => useLayeredList<number>({ filterKey: k, fetchPage }),
      { initialProps: { k: 'a' } },
    );

    // Supersede the first filter before its page resolves.
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.rows).toEqual([42]));

    // The stale 'a' response lands late — it must be ignored.
    act(() => resolveSlow(page([1, 1, 1], true)));
    await Promise.resolve();
    expect(result.current.rows).toEqual([42]);
  });

  it('clears loadingMore when a filter change supersedes an in-flight loadMore', async () => {
    let resolveAppend: (p: LayeredPage<number>) => void = () => {};
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], true))
      .mockImplementationOnce(() => new Promise<LayeredPage<number>>((r) => { resolveAppend = r; }))
      .mockResolvedValue(page([9], false));

    const { result, rerender } = renderHook(
      ({ k }) => useLayeredList<number>({ filterKey: k, fetchPage }),
      { initialProps: { k: 'a' } },
    );
    await waitFor(() => expect(result.current.rows).toEqual([1, 2]));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    // The filter changes while the append is still out. Its late response is
    // dropped — so the reset has to clear loadingMore, or the "loading more"
    // row stays on screen for the rest of the session.
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.rows).toEqual([9]));
    act(() => resolveAppend(page([3, 4], true)));
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.rows).toEqual([9]);
  });

  it('treats hasMore with a null cursor as exhausted rather than refetching page 1 forever', async () => {
    // A backend that reports "more available" but hands back no cursor used to
    // leave cursorRef at null, so every loadMore re-fetched the FIRST page and
    // appended it again — unbounded duplicate rows.
    const fetchPage = vi.fn().mockResolvedValue({ rows: [1, 2], nextCursor: null, hasMore: true });

    const { result } = renderHook(() => useLayeredList<number>({ filterKey: 'all', fetchPage }));
    await waitFor(() => expect(result.current.rows).toEqual([1, 2]));

    expect(result.current.hasMore).toBe(false);
    act(() => result.current.loadMore());
    await Promise.resolve();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toEqual([1, 2]);
  });

  it('defers fetching while disabled, then fetches once enabled', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([7], false));

    const { result, rerender } = renderHook(
      ({ on }) => useLayeredList<number>({ filterKey: 'all', fetchPage, enabled: on }),
      { initialProps: { on: false } },
    );

    await Promise.resolve();
    expect(fetchPage).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(result.current.rows).toEqual([7]));
  });
});
