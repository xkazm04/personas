import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  cadenceForAge,
  useRelativeTimeTick,
  useFixedTicker,
  _tickerStateForTests,
  _resetTickerForTests,
} from '../relativeTimeTicker';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('cadenceForAge', () => {
  it('ticks every second under a minute', () => {
    expect(cadenceForAge(0)).toBe(SECOND);
    expect(cadenceForAge(59 * SECOND)).toBe(SECOND);
  });

  it('ticks every 30s under an hour', () => {
    expect(cadenceForAge(MINUTE)).toBe(30 * SECOND);
    expect(cadenceForAge(59 * MINUTE)).toBe(30 * SECOND);
  });

  it('ticks every 5m beyond an hour', () => {
    expect(cadenceForAge(HOUR)).toBe(5 * MINUTE);
    expect(cadenceForAge(48 * HOUR)).toBe(5 * MINUTE);
  });

  it('treats future timestamps by magnitude', () => {
    expect(cadenceForAge(-30 * SECOND)).toBe(SECOND);
    expect(cadenceForAge(-2 * HOUR)).toBe(5 * MINUTE);
  });
});

describe('shared relative-time ticker', () => {
  beforeEach(() => {
    _resetTickerForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterEach(() => {
    _resetTickerForTests();
    vi.useRealTimers();
  });

  it('starts no timer when there are no subscribers', () => {
    expect(_tickerStateForTests().running).toBe(false);
  });

  it('starts a timer at the fresh-timestamp cadence on first subscribe', () => {
    const fresh = Date.now() - 5 * SECOND;
    renderHook(() => useRelativeTimeTick(fresh));
    const state = _tickerStateForTests();
    expect(state.running).toBe(true);
    expect(state.subscriberCount).toBe(1);
    expect(state.timerCadence).toBe(SECOND);
  });

  it('does not subscribe for a null timestamp (no timer pressure)', () => {
    renderHook(() => useRelativeTimeTick(null));
    expect(_tickerStateForTests().subscriberCount).toBe(0);
    expect(_tickerStateForTests().running).toBe(false);
  });

  it('runs the timer at the finest cadence any subscriber needs', () => {
    const fresh = Date.now() - 5 * SECOND; // 1s cadence
    const old = Date.now() - 2 * HOUR; // 5m cadence
    renderHook(() => useRelativeTimeTick(old));
    expect(_tickerStateForTests().timerCadence).toBe(5 * MINUTE);

    renderHook(() => useRelativeTimeTick(fresh));
    // Now the finer (1s) subscriber dominates.
    expect(_tickerStateForTests().timerCadence).toBe(SECOND);
    expect(_tickerStateForTests().subscriberCount).toBe(2);
  });

  it('re-renders subscribers on each tick', () => {
    let renders = 0;
    const fresh = Date.now() - 5 * SECOND;
    renderHook(() => {
      renders += 1;
      useRelativeTimeTick(fresh);
    });
    expect(renders).toBe(1);
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(renders).toBe(2);
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(renders).toBe(3);
  });

  it('stops the timer when the last subscriber unmounts', () => {
    const fresh = Date.now() - 5 * SECOND;
    const { unmount } = renderHook(() => useRelativeTimeTick(fresh));
    expect(_tickerStateForTests().running).toBe(true);
    unmount();
    expect(_tickerStateForTests().running).toBe(false);
    expect(_tickerStateForTests().subscriberCount).toBe(0);
  });

  it('useFixedTicker subscribes at a constant cadence', () => {
    const { unmount } = renderHook(() => useFixedTicker(60 * SECOND));
    const state = _tickerStateForTests();
    expect(state.running).toBe(true);
    expect(state.timerCadence).toBe(60 * SECOND);
    unmount();
    expect(_tickerStateForTests().running).toBe(false);
  });

  it('coalesces a fixed ticker and a fresh relative ticker onto one finer timer', () => {
    renderHook(() => useFixedTicker(60 * SECOND));
    expect(_tickerStateForTests().timerCadence).toBe(60 * SECOND);
    renderHook(() => useRelativeTimeTick(Date.now() - 2 * SECOND));
    expect(_tickerStateForTests().subscriberCount).toBe(2);
    expect(_tickerStateForTests().timerCadence).toBe(SECOND);
  });
});
