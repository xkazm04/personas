import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  computeSinceLeftBriefing,
  readLastSeen,
  useLastSeenHeartbeat,
  useSinceLeftBriefing,
  writeLastSeen,
  type BriefingInput,
} from './sinceLeftBriefing';
import { useOverviewStore } from '@/stores/overviewStore';

const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const LAST_SEEN = NOW - 6 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function input(over: Partial<BriefingInput> = {}): BriefingInput {
  return { runs: [], alerts: [], approvalsWaiting: 0, ...over };
}

describe('computeSinceLeftBriefing', () => {
  it('is a quiet first-run when there is no prior anchor', () => {
    const r = computeSinceLeftBriefing(input({ approvalsWaiting: 3 }), null);
    expect(r.firstRun).toBe(true);
    expect(r.lines).toEqual([]);
  });

  it('produces no lines when nothing happened since last visit', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [{ persona_id: 'a', status: 'completed', created_at: iso(LAST_SEEN - HOUR) }],
        alerts: [{ fired_at: iso(LAST_SEEN - HOUR) }],
      }),
      LAST_SEEN,
    );
    expect(r.firstRun).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it('counts runs since last visit and how many failed', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [
          { persona_id: 'a', status: 'completed', created_at: iso(NOW - HOUR) },
          { persona_id: 'b', status: 'failed', created_at: iso(NOW - 2 * HOUR) },
          { persona_id: 'c', status: 'failed', created_at: iso(NOW - 3 * HOUR) },
          { persona_id: 'd', status: 'completed', created_at: iso(LAST_SEEN - HOUR) }, // before anchor
        ],
      }),
      LAST_SEEN,
    );
    expect(r.lines).toEqual([{ kind: 'runs', count: 3, failed: 2 }]);
  });

  it('counts alerts raised strictly after the anchor', () => {
    const r = computeSinceLeftBriefing(
      input({
        alerts: [
          { fired_at: iso(NOW - HOUR) },
          { fired_at: iso(LAST_SEEN) }, // exactly at anchor → excluded (strict >)
          { fired_at: 'garbage' },      // unparseable → skipped
        ],
      }),
      LAST_SEEN,
    );
    expect(r.lines).toEqual([{ kind: 'alerts', count: 1 }]);
  });

  it('includes approvals waiting as a current-state count', () => {
    const r = computeSinceLeftBriefing(input({ approvalsWaiting: 2 }), LAST_SEEN);
    expect(r.lines).toEqual([{ kind: 'approvals', count: 2 }]);
  });

  it('orders lines runs → alerts → approvals when all present', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [{ persona_id: 'a', status: 'failed', created_at: iso(NOW - HOUR) }],
        alerts: [{ fired_at: iso(NOW - HOUR) }],
        approvalsWaiting: 4,
      }),
      LAST_SEEN,
    );
    expect(r.lines.map((l) => l.kind)).toEqual(['runs', 'alerts', 'approvals']);
    expect(r.lines[0]).toEqual({ kind: 'runs', count: 1, failed: 1 });
  });

  it('treats a null runs sample (not yet loaded) as no runs line', () => {
    const r = computeSinceLeftBriefing(input({ runs: null, approvalsWaiting: 1 }), LAST_SEEN);
    expect(r.lines).toEqual([{ kind: 'approvals', count: 1 }]);
  });

  it('distinguishes a quiet week from a derivation that could not run', () => {
    // Both render nothing. That is the whole trap: a briefing that has
    // silently stopped working looks exactly like a peaceful week, and nobody
    // files a bug against an absence. The two must be different observations.
    const quiet = computeSinceLeftBriefing(input(), LAST_SEEN);
    const notDerived = computeSinceLeftBriefing(input({ runs: null }), LAST_SEEN);

    expect(quiet.lines).toEqual([]);
    expect(notDerived.lines).toEqual([]);

    expect(quiet.outcome).toBe('quiet');
    expect(quiet.unavailable).toEqual([]);
    expect(notDerived.outcome).toBe('not-derived');
    expect(notDerived.unavailable).toEqual(['runs']);
  });

  it('names the outcome even when it did render, and on first run', () => {
    expect(computeSinceLeftBriefing(input({ approvalsWaiting: 2 }), LAST_SEEN).outcome).toBe('briefed');
    expect(computeSinceLeftBriefing(input(), null).outcome).toBe('first-run');
    // A partial render still reports the input it never saw.
    const partial = computeSinceLeftBriefing(input({ runs: null, approvalsWaiting: 2 }), LAST_SEEN);
    expect(partial.outcome).toBe('briefed');
    expect(partial.unavailable).toEqual(['runs']);
  });
});

/**
 * The anchor is only useful if something actually writes it. Until the
 * heartbeat moved onto `HomePage` the only writer was the briefing hook, which
 * mounts on the DEV-only Welcome surface — so a production profile carried no
 * anchor at all and every launch read as a first run.
 */
describe('useLastSeenHeartbeat', () => {
  let hidden = false;

  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps the anchor on mount with no Welcome surface in the tree', () => {
    expect(readLastSeen()).toBeNull();
    renderHook(() => useLastSeenHeartbeat());
    const stamped = readLastSeen();
    expect(stamped).not.toBeNull();
    expect(stamped).toBeGreaterThan(0);
  });

  it('does not advance the anchor while the window is hidden', () => {
    const { unmount } = renderHook(() => useLastSeenHeartbeat());
    const atMount = readLastSeen();
    expect(atMount).not.toBeNull();

    hidden = true;
    // Three heartbeats' worth of a minimized night.
    vi.advanceTimersByTime(3 * 60_000);
    expect(readLastSeen()).toBe(atMount);

    hidden = false;
    vi.advanceTimersByTime(60_000);
    expect(readLastSeen()).toBeGreaterThan(atMount as number);
    unmount();
  });

  it('leaves a stamp a second launch can read as its prior-session anchor', () => {
    const { unmount } = renderHook(() => useLastSeenHeartbeat());
    const firstSession = readLastSeen();
    unmount();

    // Second launch: the anchor frozen at first render is the prior stamp, not
    // null, so a briefing keyed on it can run.
    expect(readLastSeen()).toBe(firstSession);
    expect(computeSinceLeftBriefing(input({ approvalsWaiting: 1 }), readLastSeen()).firstRun).toBe(
      false,
    );
  });
});

/**
 * `computeSinceLeftBriefing` has distinguished quiet from not-derived since it
 * was written, and its tests above prove it. The HOOK threw the distinction
 * away: it destructured only `lines` and `firstRun`, so an input that never
 * loaded rendered exactly like a peaceful week.
 */
describe('useSinceLeftBriefing outcome', () => {
  const HOUR_MS = 60 * 60 * 1000;

  beforeEach(() => {
    localStorage.clear();
    // A prior session, so the hook is not in its first-run branch.
    writeLastSeen(Date.now() - 6 * HOUR_MS);
    useOverviewStore.setState({
      homeRunsSample: null,
      alertHistory: [],
      pendingReviewCount: 0,
    });
  });

  it('stays visible with a not-derived outcome when an input never loaded', () => {
    const { result } = renderHook(() => useSinceLeftBriefing());
    expect(result.current.outcome).toBe('not-derived');
    expect(result.current.unavailable).toEqual(['runs']);
    expect(result.current.lines).toEqual([]);
    expect(result.current.visible).toBe(true);
  });

  it('stays silent for a genuinely quiet week', () => {
    useOverviewStore.setState({ homeRunsSample: [] });
    const { result } = renderHook(() => useSinceLeftBriefing());
    expect(result.current.outcome).toBe('quiet');
    expect(result.current.visible).toBe(false);
  });

  it('reports briefed once the delta has something in it', () => {
    useOverviewStore.setState({ homeRunsSample: [], pendingReviewCount: 2 });
    const { result } = renderHook(() => useSinceLeftBriefing());
    expect(result.current.outcome).toBe('briefed');
    expect(result.current.visible).toBe(true);
    expect(result.current.lines).toEqual([{ kind: 'approvals', count: 2 }]);
  });

  it('retry re-primes the spine past its TTL', () => {
    const primeHomeSpine = vi.fn();
    useOverviewStore.setState({ primeHomeSpine: primeHomeSpine as never });
    const { result } = renderHook(() => useSinceLeftBriefing());
    primeHomeSpine.mockClear();
    result.current.retry();
    expect(primeHomeSpine).toHaveBeenCalledWith(true);
  });
});
