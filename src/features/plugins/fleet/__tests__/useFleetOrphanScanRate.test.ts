/**
 * The visibility-flip rate limit on the orphan poll.
 *
 * `detectProcesses` walks the OS process table — the priciest poll in Fleet, as
 * the hook's own comment says. The effect that owns its interval lists `visible`
 * in its dependency array, so every alt-tab tore the interval down and rebuilt
 * it; the rebuild called `scan()` synchronously with no memory of when the last
 * scan ran, making the scan frequency a function of how often the operator
 * changes windows.
 *
 * These tests pin the discriminator: N visibility flips inside one interval must
 * cost ONE scan, and a hide longer than the interval must still resume promptly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const detectProcesses = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('@/api/fleet/fleet', () => ({ detectProcesses }));

const visibleBox = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/utility/useDocumentVisibility', () => ({
  useDocumentVisibility: () => visibleBox.value,
}));

const setOrphanCount = vi.hoisted(() => vi.fn());
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { fleetSetOrphanCount: unknown }) => unknown) =>
    selector({ fleetSetOrphanCount: setOrphanCount }),
}));

import { useFleetOrphanScan } from '../useFleetOrphanScan';

const INTERVAL = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  detectProcesses.mockClear();
  visibleBox.value = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useFleetOrphanScan visibility rate limit', () => {
  it('costs exactly one process-table scan across five alt-tabs inside one interval', () => {
    const { rerender } = renderHook(() => useFleetOrphanScan(INTERVAL));
    expect(detectProcesses).toHaveBeenCalledTimes(1); // the mount scan

    for (let i = 0; i < 5; i += 1) {
      visibleBox.value = false;
      rerender();
      vi.advanceTimersByTime(1_000);
      visibleBox.value = true;
      rerender();
      vi.advanceTimersByTime(1_000);
    }

    // 10s of wall clock elapsed — far inside the 60s budget, so none of the five
    // re-shows earned a scan of its own.
    expect(detectProcesses).toHaveBeenCalledTimes(1);
  });

  it('scans immediately when the window comes back after longer than the interval', () => {
    const { rerender } = renderHook(() => useFleetOrphanScan(INTERVAL));
    expect(detectProcesses).toHaveBeenCalledTimes(1);

    visibleBox.value = false;
    rerender();
    vi.advanceTimersByTime(INTERVAL + 5_000);
    visibleBox.value = true;
    rerender();

    expect(detectProcesses).toHaveBeenCalledTimes(2);
  });

  it('still polls on the interval while the window stays visible', () => {
    renderHook(() => useFleetOrphanScan(INTERVAL));
    expect(detectProcesses).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL);
    expect(detectProcesses).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(INTERVAL);
    expect(detectProcesses).toHaveBeenCalledTimes(3);
  });

  it('serves the remainder of the budget after a short hide, not a fresh full interval', () => {
    const { rerender } = renderHook(() => useFleetOrphanScan(INTERVAL));
    expect(detectProcesses).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50_000);
    visibleBox.value = false;
    rerender();
    vi.advanceTimersByTime(1_000);
    visibleBox.value = true;
    rerender();
    expect(detectProcesses).toHaveBeenCalledTimes(1);

    // 51s were already spent — the deferred scan is owed 9s later, not 60s.
    vi.advanceTimersByTime(9_000);
    expect(detectProcesses).toHaveBeenCalledTimes(2);
  });
});
