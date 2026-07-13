import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Sentry + log sinks so we can assert on rollup / sampling behaviour.
const captureException = vi.fn();
const addBreadcrumb = vi.fn();
vi.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
}));

const logInfo = vi.fn();
vi.mock('../log', () => ({
  log: { info: (...a: unknown[]) => logInfo(...a), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  recordSwallow,
  flushSwallowRollupNow,
  getSwallowSnapshot,
  __resetSwallowTrackerForTests,
  SWALLOW_ROLLUP_MAX,
  SWALLOW_ROLLUP_INTERVAL_MS,
  SWALLOW_SAMPLE_EVERY,
  SWALLOW_SAMPLE_MIN_INTERVAL_MS,
} from '../silentFailureTelemetry';

beforeEach(() => {
  __resetSwallowTrackerForTests();
  captureException.mockClear();
  addBreadcrumb.mockClear();
  logInfo.mockClear();
});

describe('silentFailureTelemetry — counter', () => {
  it('accumulates window + session totals and distinct tags', () => {
    const t0 = 1_000;
    recordSwallow('a:x', 'boom', undefined, t0);
    recordSwallow('a:x', 'boom', undefined, t0 + 1);
    recordSwallow('b:y', 'nope', undefined, t0 + 2);

    const snap = getSwallowSnapshot(t0 + 3);
    expect(snap.windowTotal).toBe(3);
    expect(snap.sessionTotal).toBe(3);
    expect(snap.distinctTags).toBe(2);
  });

  it('survives module state across calls (globalThis singleton)', () => {
    recordSwallow('a:x', 'boom', undefined, 10);
    expect(getSwallowSnapshot(11).sessionTotal).toBe(1);
    recordSwallow('a:x', 'boom', undefined, 12);
    expect(getSwallowSnapshot(13).sessionTotal).toBe(2);
  });
});

describe('silentFailureTelemetry — rollup cadence', () => {
  it('flushes by count once SWALLOW_ROLLUP_MAX is reached', () => {
    const t0 = 1_000;
    for (let i = 0; i < SWALLOW_ROLLUP_MAX; i++) {
      recordSwallow('hot:tag', 'e', undefined, t0 + i); // stays within the time window
    }
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'silentFailure.rollup' }),
    );
    // Window cleared after flush; session total preserved.
    const snap = getSwallowSnapshot(t0 + SWALLOW_ROLLUP_MAX);
    expect(snap.windowTotal).toBe(0);
    expect(snap.sessionTotal).toBe(SWALLOW_ROLLUP_MAX);
    expect(snap.distinctTags).toBe(0);
  });

  it('flushes by time once SWALLOW_ROLLUP_INTERVAL_MS elapses', () => {
    const t0 = 1_000;
    recordSwallow('slow:tag', 'e', undefined, t0);
    expect(logInfo).not.toHaveBeenCalled();
    // Next swallow lands after the interval → time-based flush.
    recordSwallow('slow:tag', 'e', undefined, t0 + SWALLOW_ROLLUP_INTERVAL_MS + 1);
    expect(logInfo).toHaveBeenCalledTimes(1);
  });

  it('rollup summary reports the top tag by count', () => {
    const t0 = 1_000;
    for (let i = 0; i < 3; i++) recordSwallow('quiet', 'e', undefined, t0 + i);
    for (let i = 0; i < 10; i++) recordSwallow('loud', 'e', undefined, t0 + 10 + i);
    flushSwallowRollupNow(t0 + 100);

    const [, , summary] = logInfo.mock.calls[0] as [string, string, { top: Array<{ tag: string; count: number }> }];
    expect(summary.top[0].tag).toBe('loud');
    expect(summary.top[0].count).toBe(10);
  });

  it('does not flush an empty window (no swallows → no log)', () => {
    // Time-elapsed check with nothing pending must not emit a rollup.
    flushSwallowRollupNow(1_000 + SWALLOW_ROLLUP_INTERVAL_MS + 1);
    expect(logInfo).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe('silentFailureTelemetry — sampling', () => {
  it('captures on every Nth occurrence of a hot tag', () => {
    const t0 = 1_000;
    // First sample fires on the SWALLOW_SAMPLE_EVERY-th hit. Space subsequent
    // ticks past the global cool-down so the rate-limit lets them through.
    for (let i = 1; i <= SWALLOW_SAMPLE_EVERY; i++) {
      recordSwallow('hot', 'boom', new Error('boom'), t0 + i);
    }
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { silent_swallow: 'hot' } }),
    );
  });

  it('rate-limits captures within the global cool-down window', () => {
    const t0 = 1_000;
    // 2 * N hits all within the cool-down → only the first sample tick captures.
    for (let i = 1; i <= SWALLOW_SAMPLE_EVERY * 2; i++) {
      recordSwallow('hot', 'boom', new Error('boom'), t0 + i);
    }
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('allows a second capture after the cool-down elapses', () => {
    const t0 = 1_000;
    for (let i = 1; i <= SWALLOW_SAMPLE_EVERY; i++) {
      recordSwallow('hot', 'boom', new Error('boom'), t0 + i);
    }
    // Jump past the cool-down, then hit the next sample tick.
    const base = t0 + SWALLOW_SAMPLE_MIN_INTERVAL_MS + 1;
    for (let i = 1; i <= SWALLOW_SAMPLE_EVERY; i++) {
      recordSwallow('hot', 'boom', new Error('boom'), base + i);
    }
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('never captures when no Error object is supplied', () => {
    const t0 = 1_000;
    for (let i = 1; i <= SWALLOW_SAMPLE_EVERY * 2; i++) {
      recordSwallow('hot', 'boom', undefined, t0 + i);
    }
    expect(captureException).not.toHaveBeenCalled();
  });
});
