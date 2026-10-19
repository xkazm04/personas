import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Abandoning a running compose stops the agent behind it.
 *
 * "Compose & test with AI" starts a backend task (a CLI agent that writes and
 * runs a measurement command) and the modal polls it. Closing the modal or
 * switching mechanism only stopped the POLL; the agent kept running and
 * spending to produce a result nothing would read, because `kpi_measure`
 * results are applied only by the modal's Apply button. `cancelKpiCompose`
 * existed with zero callers. A poll that was already in flight when the task
 * was abandoned could also land afterwards and flip a reset modal to "done".
 */
const getKpiComposeStatus = vi.fn();
const cancelKpiCompose = vi.fn().mockResolvedValue(true);
vi.mock('@/api/devTools/kpis', () => ({
  getKpiComposeStatus: (...a: unknown[]) => getKpiComposeStatus(...a),
  cancelKpiCompose: (...a: unknown[]) => cancelKpiCompose(...a),
}));

import { useComposeTask } from '../composeTask';

const start = () => Promise.resolve({ task_id: 't1' });

describe('useComposeTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getKpiComposeStatus.mockReset().mockResolvedValue({ task_id: 't1', status: 'running', lines: [] });
    cancelKpiCompose.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('unmounting while running cancels the backend task', async () => {
    const { result, unmount } = renderHook(() => useComposeTask());
    await act(async () => { await result.current.run(start); });
    unmount();
    expect(cancelKpiCompose).toHaveBeenCalledWith('t1');
  });

  it('reset while running cancels it, and a late poll cannot revive the old task', async () => {
    let settle!: (s: unknown) => void;
    getKpiComposeStatus.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    const { result } = renderHook(() => useComposeTask());
    await act(async () => { await result.current.run(start); });
    await act(async () => { vi.advanceTimersByTime(1500); }); // poll now in flight
    act(() => result.current.reset());
    expect(cancelKpiCompose).toHaveBeenCalledWith('t1');
    await act(async () => { settle({ task_id: 't1', status: 'completed', lines: ['ok'] }); });
    expect(result.current.phase).toBe('idle');
    expect(result.current.lines).toEqual([]);
  });

  it('closing while the task is still starting cancels it once it has an id', async () => {
    let started!: (v: { task_id: string }) => void;
    const slowStart = () => new Promise<{ task_id: string }>((r) => { started = r; });
    const { result, unmount } = renderHook(() => useComposeTask());
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(slowStart); });
    unmount();
    await act(async () => { started({ task_id: 't2' }); await pending; });
    expect(cancelKpiCompose).toHaveBeenCalledWith('t2');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(getKpiComposeStatus).not.toHaveBeenCalled();
  });

  it('a finished task is not cancelled on unmount', async () => {
    getKpiComposeStatus.mockResolvedValue({ task_id: 't1', status: 'completed', lines: [] });
    const { result, unmount } = renderHook(() => useComposeTask());
    await act(async () => { await result.current.run(start); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(result.current.phase).toBe('done');
    unmount();
    expect(cancelKpiCompose).not.toHaveBeenCalled();
  });
});
