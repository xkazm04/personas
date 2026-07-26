import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { useStableLoading } from './useStableLoading';

const OPTS = { graceMs: 140, minVisibleMs: 420 };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useStableLoading', () => {
  it('never shows the placeholder for a load that clears within the grace window (anti-flash)', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading }) => useStableLoading(loading, OPTS),
      { initialProps: { loading: true } },
    );
    expect(result.current).toBe(false);
    // Clear before grace elapses.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ loading: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current).toBe(false);
  });

  it('shows the placeholder once loading outlasts the grace window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStableLoading(true, OPTS));
    expect(result.current).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(result.current).toBe(true);
  });

  it('keeps a shown placeholder visible for at least minVisibleMs (anti-blink)', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading }) => useStableLoading(loading, OPTS),
      { initialProps: { loading: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(result.current).toBe(true);
    // Loading clears almost immediately after the placeholder appeared.
    rerender({ loading: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current).toBe(true); // still held by min-visible
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current).toBe(false);
  });
});
