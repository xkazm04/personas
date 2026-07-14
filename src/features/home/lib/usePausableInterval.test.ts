import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePausableInterval } from './usePausableInterval';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePausableInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not fire on first mount, then ticks on the interval while active', () => {
    const cb = vi.fn();
    renderHook(() => usePausableInterval(cb, 1000, true));
    expect(cb).toHaveBeenCalledTimes(0); // no immediate fire on first mount
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does nothing while inactive', () => {
    const cb = vi.fn();
    renderHook(() => usePausableInterval(cb, 1000, false));
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('pauses when inactive and refreshes + resumes when re-activated', () => {
    const cb = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => usePausableInterval(cb, 1000, active),
      { initialProps: { active: true } },
    );
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1); // paused — no ticks while inactive

    rerender({ active: true });
    expect(cb).toHaveBeenCalledTimes(2); // immediate refresh on re-activation
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(3); // interval resumed
  });

  it('pauses while hidden and refreshes when the document becomes visible', () => {
    const cb = vi.fn();
    renderHook(() => usePausableInterval(cb, 1000, true));

    setHidden(true);
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(0); // paused while hidden

    setHidden(false);
    expect(cb).toHaveBeenCalledTimes(1); // refresh on becoming visible
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3); // interval resumed
  });
});
