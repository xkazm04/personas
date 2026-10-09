import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

import {
  __resetHistoryCacheForTests, cachedLifecycleHistory, prefetchLifecycleHistory, useLifecycleHistory,
} from '../useLifecycleHistory';
import { sixMeasures } from './historyFixtures';

const getLifecycleHistory = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleHistory }));

beforeEach(() => {
  __resetHistoryCacheForTests();
  getLifecycleHistory.mockReset();
  getLifecycleHistory.mockImplementation(async () => sixMeasures());
});

afterEach(() => { __resetHistoryCacheForTests(); });

describe('useLifecycleHistory', () => {
  it('waits for the rail (enabled) and then reads once, on idle', async () => {
    const { result, rerender } = renderHook(({ on }) => useLifecycleHistory('p-a', on), { initialProps: { on: false } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getLifecycleHistory).not.toHaveBeenCalled();
    expect(result.current.history).toBeNull();

    rerender({ on: true });
    // Deferred to an idle slice: not called synchronously with the render that enabled it.
    expect(getLifecycleHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.history?.measures).toHaveLength(6));
    expect(getLifecycleHistory).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('paints a warm copy at once on remount and revalidates when a write lands', async () => {
    const first = renderHook(() => useLifecycleHistory('p-b'));
    await waitFor(() => expect(first.result.current.history).not.toBeNull());
    first.unmount();

    const again = renderHook(() => useLifecycleHistory('p-b'));
    expect(again.result.current.history?.measures).toHaveLength(6);
    await waitFor(() => expect(again.result.current.loading).toBe(false));
    const calls = getLifecycleHistory.mock.calls.length;

    const shown = again.result.current.history;
    act(() => { useDevToolsLiveStore.setState((s) => ({ lifecycleRevision: s.lifecycleRevision + 1 })); });
    await waitFor(() => expect(getLifecycleHistory.mock.calls.length).toBe(calls + 1));
    await waitFor(() => expect(again.result.current.loading).toBe(false));
    expect(again.result.current.history?.measures).toHaveLength(6);
    // The same history read again is the same object: nothing that draws it re-renders (wave 10).
    expect(again.result.current.history).toBe(shown);
  });

  it('joins a prefetch already in flight instead of asking twice', async () => {
    let resolve!: (v: unknown) => void;
    getLifecycleHistory.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    prefetchLifecycleHistory('p-c');
    prefetchLifecycleHistory('p-c');
    const { result } = renderHook(() => useLifecycleHistory('p-c'));
    await waitFor(() => expect(getLifecycleHistory).toHaveBeenCalled());
    await act(async () => { resolve(sixMeasures()); });
    await waitFor(() => expect(result.current.history).not.toBeNull());
    expect(getLifecycleHistory).toHaveBeenCalledTimes(1);
    expect(cachedLifecycleHistory('p-c')?.measures).toHaveLength(6);
  });

  it('reports a failure, and a retry asks again', async () => {
    getLifecycleHistory.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = renderHook(() => useLifecycleHistory('p-d'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.history).toBeNull();
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.history?.measures).toHaveLength(6));
    expect(result.current.error).toBeNull();
  });
});
