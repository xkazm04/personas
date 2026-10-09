import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  cadenceForAge,
  useRelativeTimeTick,
  useFixedTicker,
  useQuantizedNow,
  _tickerStateForTests,
  _resetTickerForTests,
  _setDocumentHiddenForTests,
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

describe('per-subscriber due times (the 1 Hz contagion)', () => {
  beforeEach(() => {
    _resetTickerForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterEach(() => {
    _resetTickerForTests();
    vi.useRealTimers();
  });

  it('calls a 30s subscriber every 30s even while a 1s subscriber is live', () => {
    let slowCalls = 0;
    let fastCalls = 0;
    renderHook(() => {
      slowCalls += 1;
      useFixedTicker(30 * SECOND);
    });
    renderHook(() => {
      fastCalls += 1;
      useRelativeTimeTick(Date.now() - 5 * SECOND); // 1s cadence
    });
    // The TIMER still runs at the finest cadence — that is what keeps the 1s
    // label honest. What changed is who it calls.
    expect(_tickerStateForTests().timerCadence).toBe(SECOND);
    slowCalls = 0;
    fastCalls = 0;

    // One `act` PER TICK: React batches every update inside a single `act`, so
    // advancing 29s in one go would collapse 29 ticks into one render and the
    // assertion would measure batching rather than the ticker.
    const tick = () => act(() => { vi.advanceTimersByTime(SECOND); });

    for (let i = 0; i < 29; i += 1) tick();
    expect(fastCalls).toBe(29);
    expect(slowCalls).toBe(0); // not yet due — this is the regression under test

    tick();
    expect(slowCalls).toBe(1);

    for (let i = 0; i < 30; i += 1) tick();
    expect(slowCalls).toBe(2);
    expect(fastCalls).toBe(60); // the 1s label kept its own cadence throughout
  });

  it('a 60s subscriber is called once a minute, not 60 times', () => {
    renderHook(() => useRelativeTimeTick(Date.now() - 5 * SECOND));
    let calls = 0;
    renderHook(() => {
      calls += 1;
      useFixedTicker(60 * SECOND);
    });
    calls = 0;
    for (let i = 0; i < 120; i += 1) act(() => { vi.advanceTimersByTime(SECOND); });
    expect(calls).toBe(2);
  });

  it('serves a subscriber whose due time is a hair away (timer jitter slack)', () => {
    let calls = 0;
    renderHook(() => {
      calls += 1;
      useFixedTicker(2 * SECOND);
    });
    renderHook(() => useFixedTicker(SECOND));
    calls = 0;
    // Two 1s ticks: the first is 1s early for the 2s subscriber, the second is
    // exactly due.
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(calls).toBe(0);
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(calls).toBe(1);
  });

  it('brings a subscriber forward when its cadence narrows mid-flight', () => {
    // A label crossing from "2m ago" (30s) into nothing finer here; drive the
    // bucket change directly through a timestamp that ages across a boundary.
    let ts = Date.now() - 2 * MINUTE; // 30s cadence
    const { rerender } = renderHook(() => useRelativeTimeTick(ts));
    expect(_tickerStateForTests().timerCadence).toBe(30 * SECOND);
    ts = Date.now() - 5 * SECOND; // 1s cadence
    rerender();
    expect(_tickerStateForTests().timerCadence).toBe(SECOND);
  });
});

describe('document visibility', () => {
  beforeEach(() => {
    _resetTickerForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterEach(() => {
    _setDocumentHiddenForTests(null);
    _resetTickerForTests();
    vi.useRealTimers();
  });

  it('stops the timer while the document is hidden', () => {
    let calls = 0;
    renderHook(() => {
      calls += 1;
      useFixedTicker(SECOND);
    });
    expect(_tickerStateForTests().running).toBe(true);
    calls = 0;

    act(() => {
      _setDocumentHiddenForTests(true);
    });
    expect(_tickerStateForTests().running).toBe(false);
    expect(_tickerStateForTests().hidden).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60 * SECOND);
    });
    expect(calls).toBe(0);
  });

  it('does not start a timer for a subscriber mounted while hidden', () => {
    act(() => {
      _setDocumentHiddenForTests(true);
    });
    renderHook(() => useFixedTicker(SECOND));
    expect(_tickerStateForTests().subscriberCount).toBe(1);
    expect(_tickerStateForTests().running).toBe(false);
  });

  it('catches every subscriber up once on the way back, and resumes', () => {
    let calls = 0;
    renderHook(() => {
      calls += 1;
      useFixedTicker(5 * MINUTE);
    });
    act(() => {
      _setDocumentHiddenForTests(true);
    });
    calls = 0;
    act(() => {
      vi.advanceTimersByTime(HOUR);
    });
    expect(calls).toBe(0);

    act(() => {
      _setDocumentHiddenForTests(false);
    });
    expect(calls).toBe(1); // one catch-up, not twelve
    expect(_tickerStateForTests().running).toBe(true);
    expect(_tickerStateForTests().timerCadence).toBe(5 * MINUTE);

    act(() => {
      vi.advanceTimersByTime(5 * MINUTE);
    });
    expect(calls).toBe(2);
  });
});

describe('useQuantizedNow', () => {
  beforeEach(() => {
    _resetTickerForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterEach(() => {
    _setDocumentHiddenForTests(null);
    _resetTickerForTests();
    vi.useRealTimers();
  });

  it('returns the exact clock on mount and holds that identity between ticks', () => {
    const mounted = Date.now();
    let renders = 0;
    const seen: number[] = [];
    const { rerender } = renderHook(() => {
      renders += 1;
      seen.push(useQuantizedNow(30 * SECOND));
    });
    expect(seen[0]).toBe(mounted);

    // Time passes and the parent re-renders for unrelated reasons: the value
    // must NOT move, or every memo that closes over it is invalidated.
    vi.setSystemTime(mounted + 12 * SECOND);
    rerender();
    rerender();
    expect(seen.at(-1)).toBe(mounted);
    expect(renders).toBe(3);
  });

  it('advances by exactly one cadence per tick', () => {
    const mounted = Date.now();
    const seen: number[] = [];
    renderHook(() => {
      seen.push(useQuantizedNow(30 * SECOND));
    });
    act(() => {
      vi.advanceTimersByTime(30 * SECOND);
    });
    expect(seen.at(-1)).toBe(mounted + 30 * SECOND);
    act(() => {
      vi.advanceTimersByTime(30 * SECOND);
    });
    expect(seen.at(-1)).toBe(mounted + 60 * SECOND);
  });

  it('bails out of the re-render when a redundant call changes nothing', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useQuantizedNow(30 * SECOND);
    });
    const before = renders;
    // The visibility catch-up calls every subscriber; this one's bucket has not
    // moved, so React must bail out rather than re-render the panel.
    act(() => {
      _setDocumentHiddenForTests(true);
      _setDocumentHiddenForTests(false);
    });
    expect(renders).toBe(before);
  });

  it('does not tick a 30s consumer at 1 Hz because a 1s label is on screen', () => {
    renderHook(() => useRelativeTimeTick(Date.now() - 5 * SECOND));
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useQuantizedNow(30 * SECOND);
    });
    renders = 0;
    act(() => {
      vi.advanceTimersByTime(29 * SECOND);
    });
    expect(renders).toBe(0);
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(renders).toBe(1);
  });
});
