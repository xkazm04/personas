import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackedElementRect } from '../useTrackedElementRect';

/** Mount a div with the given testid and a fixed mocked bounding rect. */
function mountTarget(testId: string, box: { x: number; y: number; width: number; height: number }): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', testId);
  el.getBoundingClientRect = () =>
    ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('useTrackedElementRect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('returns null and never measures when testId is null', () => {
    const onMissing = vi.fn();
    const { result } = renderHook(() => useTrackedElementRect(null, { onMissing }));
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBeNull();
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('returns null when inactive even if the element exists', () => {
    mountTarget('present', { x: 10, y: 20, width: 30, height: 40 });
    const { result } = renderHook(() =>
      useTrackedElementRect('present', { active: false }),
    );
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBeNull();
  });

  it('measures the element rect inflated by padding after the initial settle', () => {
    mountTarget('present', { x: 100, y: 200, width: 50, height: 30 });
    const { result } = renderHook(() =>
      useTrackedElementRect('present', { padding: 6 }),
    );
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toEqual({ x: 94, y: 194, width: 62, height: 42 });
  });

  it('fires onMissing once when the target is absent from the start', () => {
    const onMissing = vi.fn();
    const { result } = renderHook(() =>
      useTrackedElementRect('ghost', { onMissing }),
    );
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toBeNull();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe testid without throwing a selector error', () => {
    const onMissing = vi.fn();
    const { result } = renderHook(() =>
      // A bracket/quote would break querySelector — the hook must guard it.
      useTrackedElementRect('bad"]', { onMissing }),
    );
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toBeNull();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });
});
