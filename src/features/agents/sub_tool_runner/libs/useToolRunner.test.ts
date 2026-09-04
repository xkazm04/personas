import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@/api/agents/tools', () => ({ invokeToolDirect: (...a: unknown[]) => invokeMock(...a) }));

import { useToolRunner } from './useToolRunner';

const ok = { success: true, output: 'hi', duration_ms: 5 };

describe('useToolRunner', () => {
  beforeEach(() => { invokeMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lands a result under the persona that started the run', async () => {
    invokeMock.mockResolvedValue(ok);
    const { result } = renderHook(() => useToolRunner('p1'));
    await act(async () => { await result.current.runTool('t1', '{}'); });
    expect(invokeMock).toHaveBeenCalledWith('t1', 'p1', '{}');
    expect(result.current.getState('t1').result).toEqual(ok);
    expect(result.current.getState('t1').isRunning).toBe(false);
  });

  it('drops a result that resolves after the persona switched', async () => {
    let resolve!: (v: unknown) => void;
    invokeMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(({ pid }) => useToolRunner(pid), { initialProps: { pid: 'p1' } });
    let run!: Promise<void>;
    act(() => { run = result.current.runTool('t1', '{}'); });
    expect(result.current.getState('t1').isRunning).toBe(true);
    rerender({ pid: 'p2' });
    await act(async () => { resolve(ok); await run; });
    // Neither persona sees the late result from the first one.
    expect(result.current.getState('t1')).toMatchObject({ result: null, isRunning: false });
  });

  it('ignores a second click on the same tool while the first is in flight', async () => {
    let resolve!: (v: unknown) => void;
    invokeMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useToolRunner('p1'));
    let first!: Promise<void>;
    act(() => { first = result.current.runTool('t1', '{}'); });
    await act(async () => { await result.current.runTool('t1', '{}'); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(ok); await first; });
  });

  it('clears the 120s watchdog once the run settles', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(ok);
    const { result } = renderHook(() => useToolRunner('p1'));
    await act(async () => { await result.current.runTool('t1', '{}'); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a structured IPC rejection into a readable error, not [object Object]', async () => {
    invokeMock.mockRejectedValue({ message: 'credential missing' });
    const { result } = renderHook(() => useToolRunner('p1'));
    await act(async () => { await result.current.runTool('t1', '{}'); });
    await waitFor(() => expect(result.current.getState('t1').error).toBe('credential missing'));
  });
});
