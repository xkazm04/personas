/**
 * WHAT THE ACTIVITY BOARD PAYS FOR BEING OPEN.
 *
 * Four separate costs are measured here, all of them on the ONE mode the
 * Monitor actually runs in — BADGE mode with a capped review page, which is
 * what `PersonaMonitor` asks for and which this file never used to exercise at
 * all (it called `useMonitorData()` with defaults and carried a 5-entry dep
 * tuple against a memo with 7):
 *
 *  1. AN UNCHANGED POLL. Twice a minute three feeds come back saying exactly
 *     what they said last time, and the board rebuilt anyway, because the
 *     feeds handed back fresh object identities for identical content.
 *     `modelBuilds` counts recomputations of a memo carrying `PersonaMonitor`'s
 *     exact dep tuple across N polls that changed nothing.
 *  2. OPENING. The mount effect read reviews, messages and summaries, and then
 *     every `usePolling` registration in the same commit read the same three
 *     again — six round trips where three are wanted.
 *  3. A DEAD BACKEND. Every loader catches internally and RESOLVES, so
 *     `usePolling`'s exponential backoff could never be reached and a failing
 *     feed was re-queried at full cadence forever.
 *  4. BEING SHUT. The overlay stopped unmounting on close, so "closed" no
 *     longer stops anything by itself.
 *
 * The health map is driven through the REAL `personaSlice` (only its API module
 * is mocked), so the numbers below are the store's behaviour and not a mock's.
 * `usePolling` IS mocked, but faithfully: it fires once when a ticker becomes
 * enabled, exactly as the real one does, because two of the four measurements
 * above are about that fire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMemo } from 'react';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

// --- mocks (must precede the import under test) ----------------------------

const mockGetSummaries = vi.fn();
const mockListReports = vi.fn();
const mockMessageCounts = vi.fn();
const mockListReviews = vi.fn();
const mockListReviewsPage = vi.fn();
const mockReviewCounts = vi.fn();

vi.mock('@/api/agents/personas', () => ({
  getPersonaSummaries: (...a: unknown[]) => mockGetSummaries(...a),
  listPersonas: vi.fn().mockResolvedValue([]),
  getPersonaDetail: vi.fn(),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
  duplicatePersona: vi.fn(),
  buildUpdateInput: vi.fn(),
  operationToPartial: vi.fn(),
}));

vi.mock('@/api/overview/reports', () => ({
  listReports: (...a: unknown[]) => mockListReports(...a),
  getUnreadReportCountsByPersona: (...a: unknown[]) => mockMessageCounts(...a),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: (...a: unknown[]) => mockListReviewsPage(...a),
  getPendingReviewCountsByPersona: (...a: unknown[]) => mockReviewCounts(...a),
  updateManualReviewStatus: vi.fn(),
  dispatchReviewAction: vi.fn(),
}));

vi.mock('@/api/system/cloud', () => ({
  cloudRespondToReview: vi.fn(),
}));

/**
 * A faithful miniature of `usePolling`: one entry per CALL SITE (keyed on a
 * ref, so re-renders do not look like new tickers), fired once whenever it
 * becomes enabled, and remembering whether the cycle rejected.
 *
 * The fire-on-enable is not decoration. Two of the things measured in this
 * file — the duplicate mount read, and what reopening a hidden Monitor costs —
 * exist only because the real hook fires on register, and a mock that merely
 * recorded the registration would have reported both as fixed while doing
 * nothing.
 */
interface Ticker {
  name?: string;
  enabled: boolean;
  fire: () => Promise<unknown>;
  rejections: number;
}
const tickers = new Map<number, Ticker>();
let nextTickerId = 0;

function ticker(name: string): Ticker | undefined {
  for (const t of tickers.values()) if (t.name === name) return t;
  return undefined;
}

vi.mock('@/hooks/utility/timing/usePolling', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    usePolling: (fn: () => unknown, opts: { enabled: boolean; name?: string }) => {
      const idRef = useRef<number | null>(null);
      if (idRef.current === null) idRef.current = ++nextTickerId;
      const id = idRef.current;
      const fnRef = useRef(fn);
      fnRef.current = fn;
      const existing = tickers.get(id);
      const entry: Ticker = {
        name: opts.name,
        enabled: opts.enabled,
        fire: async () => fnRef.current(),
        rejections: existing?.rejections ?? 0,
      };
      tickers.set(id, entry);
      useEffect(() => {
        if (!opts.enabled) return;
        void (async () => {
          try {
            await fnRef.current();
          } catch {
            // The real hook catches here too — and that catch is what arms the
            // backoff. Counting it is how this file can see a backoff happen.
            const t = tickers.get(id);
            if (t) t.rejections += 1;
          }
        })();
      }, [opts.enabled, opts.name, id]);
      return { isPolling: opts.enabled, lastRefreshed: null };
    },
    POLLING_CONFIG: {
      dashboardRefresh: { interval: 60_000 },
      cloudReviews: { interval: 60_000, maxBackoff: 60_000 },
    },
  };
});

vi.mock('@/lib/log', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

// The REAL persona slice, in a minimal zustand-shaped harness (the pattern
// `labSlice.fetchRuns.test.ts` uses). The health map's identity is the thing
// under measurement, so mocking the store would be measuring the mock.
import { createPersonaSlice, type PersonaSlice } from '@/stores/slices/agents/personaSlice';

function personaHarness() {
  let state = {} as PersonaSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createPersonaSlice as any)(set, get, {}) };
  return { get: () => state };
}

let slice = personaHarness();

const agentState = {
  get personas() { return slice.get().personas; },
  get personaHealthMap() { return slice.get().personaHealthMap; },
  get personaSummariesError() { return slice.get().personaSummariesError; },
  get personaSummariesRefreshedAt() { return slice.get().personaSummariesRefreshedAt; },
  fetchPersonaSummaries: () => slice.get().fetchPersonaSummaries(),
};
const overviewState = {
  activeProcesses: {},
  cloudReviews: [] as unknown[],
  fetchCloudReviews: vi.fn().mockResolvedValue(undefined),
  fetchPendingReviewCount: vi.fn().mockResolvedValue(undefined),
  fetchUnreadReportCount: vi.fn().mockResolvedValue(undefined),
};
const systemState = { cloudConfig: { is_connected: false } };

// `getState` as well as the selector: the health poll reads
// `personaSummariesError` from the live store AFTER its await, because a
// subscribed render value would be a commit behind. See `readHealthFailure`.
vi.mock('@/stores/agentStore', () => {
  const hook = (sel: (s: typeof agentState) => unknown) => sel(agentState);
  hook.getState = () => agentState;
  return { useAgentStore: hook };
});
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

import { MonitorVisibilityContext } from './monitorVisibility';
import { MONITOR_REVIEW_LIMIT, useMonitorData, type MonitorFeeds } from './useMonitorData';

// --- fixtures --------------------------------------------------------------

/** Exactly what `PersonaMonitor` asks for on the Activity board. */
const MONITOR_FEEDS: MonitorFeeds = {
  reviews: true,
  messages: true,
  personaHealth: true,
  badgeCounts: true,
  reviewLimit: MONITOR_REVIEW_LIMIT,
};

/** Row mode — the shape the Quick Answer popover mounts. */
const ROW_FEEDS: MonitorFeeds = { reviews: true, messages: true, personaHealth: true };

function health(status: string): PersonaHealth {
  return {
    status: status as PersonaHealth['status'],
    recentStatuses: ['completed', 'completed'],
    successRate: 1,
    totalRecent: 2n,
    runsToday: 1n,
    sparkline: [0n, 0n, 0n, 0n, 0n, 1n, 1n],
  };
}

/** A summary row shaped the way `getPersonaSummaries` shapes one. */
function summary(personaId: string, status = 'healthy') {
  return {
    personaId,
    enabledTriggerCount: 1,
    lastRunAt: '2026-01-01T00:00:00.000Z',
    health: health(status),
  };
}

function report(id: string, isRead = false) {
  return {
    id,
    persona_id: 'p1',
    execution_id: null,
    title: `Report ${id}`,
    content: 'body',
    content_type: 'markdown',
    priority: 'normal',
    is_read: isRead,
    metadata: null,
    created_at: '2026-01-01T00:00:00.000Z',
    read_at: null,
    thread_id: null,
    use_case_id: null,
  };
}

function review(id: string) {
  return {
    id,
    persona_id: 'p1',
    execution_id: 'e1',
    severity: 'high',
    title: `Review ${id}`,
    description: null,
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    created_at: '2026-01-01T00:00:00.000Z',
    resolved_at: null,
  };
}

function badge(personaId: string, pending = 1) {
  return { personaId, pending, critical: 0, warning: pending, info: 0 };
}

// --- harness ---------------------------------------------------------------

/** Recomputations of a memo carrying `PersonaMonitor`'s exact dep tuple. */
let modelBuilds = 0;

/**
 * A CONTROLLED CLOCK, because eligibility is now a function of time.
 *
 * `pollIsDue` declines a tick that would re-read what was just read — that is
 * what removes the duplicate mount read and what stops reopening the overlay
 * firing every feed at once. With a real clock every `tick()` here would land
 * inside that window and this file would measure nothing. Advancing the clock
 * explicitly is also what lets "reopened while still fresh" and "reopened
 * stale" be two different, asserted outcomes.
 */
let nowMs = 1_700_000_000_000;
function advance(ms: number) {
  nowMs += ms;
}

function useMeasuredMonitor(feeds: MonitorFeeds) {
  const data = useMonitorData(feeds);
  useMemo(() => {
    modelBuilds += 1;
    // Stands in for `buildMonitorModel(...)` — the count is what matters, and
    // touching every input keeps the dep list honest. SEVEN deps, the same
    // seven `PersonaMonitor` passes.
    return [
      data.personas.length,
      data.reviews.length,
      data.unreadMessages.length,
      Object.keys(data.activeProcesses).length,
      Object.keys(data.healthMap).length,
      Object.keys(data.reviewBadgeCounts).length,
      Object.keys(data.messageBadgeCounts).length,
    ];
  }, [
    data.personas, data.reviews, data.unreadMessages, data.activeProcesses, data.healthMap,
    data.reviewBadgeCounts, data.messageBadgeCounts,
  ]);
  return data;
}

/** Mount and settle every feed's first read (the mocked store is not reactive,
 *  so the final `rerender` is what re-reads the slice's health map). */
async function mountMeasured(feeds: MonitorFeeds = MONITOR_FEEDS) {
  const view = renderHook(() => useMeasuredMonitor(feeds));
  await waitFor(() => expect(mockGetSummaries).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  view.rerender();
  return view;
}

/** One poll tick of all three local feeds, a full cadence after the last one. */
async function tick(rerender: () => void) {
  advance(60_000);
  await act(async () => {
    await ticker('monitor:reviews')?.fire();
    await ticker('monitor:messages')?.fire();
    await ticker('monitor:personaHealth')?.fire();
  });
  rerender();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  tickers.clear();
  modelBuilds = 0;
  nowMs += 10 * 60_000; // every test starts with every feed long stale
  slice = personaHarness();
  mockListReviews.mockResolvedValue([review('r1')]);
  mockListReviewsPage.mockResolvedValue({ rows: [review('r1')], hasMore: false });
  mockReviewCounts.mockResolvedValue([badge('p1'), badge('p2', 0)]);
  mockListReports.mockResolvedValue([report('m1'), report('m2', true)]);
  mockMessageCounts.mockResolvedValue({ p1: 1 });
  mockGetSummaries.mockResolvedValue([summary('p1'), summary('p2')]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Monitor model memo across an UNCHANGED poll (badge mode)', () => {
  it('is not recomputed at all — three ticks, nothing moved', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(result.current.reviews.length).toBe(1));
    await waitFor(() => expect(Object.keys(result.current.reviewBadgeCounts).length).toBe(2));
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));

    // Everything settled: from here on the backend says the same thing.
    modelBuilds = 0;
    for (let i = 0; i < 3; i += 1) await tick(rerender);

    // THE MEASUREMENT. One recompute per tick per fresh-identity feed is what
    // an idle fleet used to pay; the target is zero.
    expect(modelBuilds).toBe(0);
  });

  it('keeps the SAME review badge counts', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.reviewBadgeCounts).length).toBe(2));
    const first = result.current.reviewBadgeCounts;

    await tick(rerender);
    expect(result.current.reviewBadgeCounts).toBe(first);
  });

  it('keeps the SAME message badge counts', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.messageBadgeCounts).length).toBe(1));
    const first = result.current.messageBadgeCounts;

    await tick(rerender);
    expect(result.current.messageBadgeCounts).toBe(first);
  });

  it('keeps the SAME personaHealthMap', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    await tick(rerender);
    expect(result.current.healthMap).toBe(first);
  });

  it('keeps the SAME unread-messages array in ROW mode', async () => {
    const { result, rerender } = await mountMeasured(ROW_FEEDS);
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    const first = result.current.unreadMessages;

    await tick(rerender);
    expect(result.current.unreadMessages).toBe(first);
  });
});

describe('the bail-out is a cache, not a freeze', () => {
  it('hands back NEW badge counts when a review lands', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.reviewBadgeCounts).length).toBe(2));
    const first = result.current.reviewBadgeCounts;

    mockReviewCounts.mockResolvedValue([badge('p1', 4), badge('p2', 0)]);
    await tick(rerender);

    expect(result.current.reviewBadgeCounts).not.toBe(first);
    expect(result.current.reviewBadgeCounts.p1!.pending).toBe(4);
  });

  it('hands back a NEW unread array when a message arrives (row mode)', async () => {
    const { result, rerender } = await mountMeasured(ROW_FEEDS);
    await waitFor(() => expect(result.current.unreadMessages.length).toBe(1));
    const first = result.current.unreadMessages;

    mockListReports.mockResolvedValue([report('m1'), report('m3')]);
    await tick(rerender);

    expect(result.current.unreadMessages).not.toBe(first);
    expect(result.current.unreadMessages).toHaveLength(2);
  });

  it('hands back a NEW health map when a persona degrades', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    mockGetSummaries.mockResolvedValue([summary('p1', 'failing'), summary('p2')]);
    await tick(rerender);

    expect(result.current.healthMap).not.toBe(first);
    expect(result.current.healthMap.p1!.status).toBe('failing');
  });

  it('hands back a NEW health map when a persona joins the fleet', async () => {
    const { result, rerender } = await mountMeasured();
    await waitFor(() => expect(Object.keys(result.current.healthMap).length).toBe(2));
    const first = result.current.healthMap;

    mockGetSummaries.mockResolvedValue([summary('p1'), summary('p2'), summary('p3')]);
    await tick(rerender);

    expect(result.current.healthMap).not.toBe(first);
    expect(Object.keys(result.current.healthMap)).toHaveLength(3);
  });
});

describe('opening the Monitor reads each feed exactly once', () => {
  it('does not double up the mount effect and the fire-on-register', async () => {
    await mountMeasured();
    await act(async () => { await Promise.resolve(); });

    // The mount effect fires these; the four tickers then register and each
    // fires immediately. Without an eligibility gate that is six round trips
    // for three answers.
    expect(mockReviewCounts).toHaveBeenCalledTimes(1);
    expect(mockListReviewsPage).toHaveBeenCalledTimes(1);
    expect(mockMessageCounts).toHaveBeenCalledTimes(1);
    expect(mockGetSummaries).toHaveBeenCalledTimes(1);
  });

  it('reads counts AND rows in one pass — the rail needs both', async () => {
    const { result } = await mountMeasured();
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));
    expect(Object.keys(result.current.reviewBadgeCounts)).toHaveLength(2);
  });

  it('a tick inside the window is declined, not served', async () => {
    const { rerender } = await mountMeasured();
    await act(async () => { await ticker('monitor:reviews')?.fire(); });
    rerender();
    expect(mockReviewCounts).toHaveBeenCalledTimes(1);

    advance(60_000);
    await act(async () => { await ticker('monitor:reviews')?.fire(); });
    expect(mockReviewCounts).toHaveBeenCalledTimes(2);
  });
});

describe('a dead backend backs the ticker off', () => {
  it('rejects the review ticker when the read fails, while still surfacing the error', async () => {
    const { result } = await mountMeasured();
    mockReviewCounts.mockRejectedValue(new Error('database is locked'));
    mockListReviewsPage.mockRejectedValue(new Error('database is locked'));

    advance(60_000);
    await act(async () => {
      await expect(ticker('monitor:reviews')!.fire()).rejects.toThrow('database is locked');
    });

    // The surface contract is unchanged: the loader still resolved for every
    // direct caller, and `reviewsError` is how the failure reaches a pixel.
    await waitFor(() => expect(result.current.reviewsError).toContain('database is locked'));
  });

  it('rejects the messages ticker when the read fails', async () => {
    const { result } = await mountMeasured();
    mockMessageCounts.mockRejectedValue(new Error('no such table'));

    advance(60_000);
    await act(async () => {
      await expect(ticker('monitor:messages')!.fire()).rejects.toThrow('no such table');
    });
    await waitFor(() => expect(result.current.messagesError).not.toBeNull());
  });

  it('rejects the health ticker, whose loader never throws at all', async () => {
    await mountMeasured();
    mockGetSummaries.mockRejectedValue(new Error('summaries unavailable'));

    advance(60_000);
    await act(async () => {
      await expect(ticker('monitor:personaHealth')!.fire()).rejects.toThrow('summaries unavailable');
    });
  });

  it('stops rejecting as soon as the backend answers again', async () => {
    await mountMeasured();
    mockReviewCounts.mockRejectedValueOnce(new Error('transient'));
    mockListReviewsPage.mockRejectedValueOnce(new Error('transient'));

    advance(60_000);
    await act(async () => {
      await expect(ticker('monitor:reviews')!.fire()).rejects.toThrow('transient');
    });

    advance(60_000);
    await act(async () => {
      await expect(ticker('monitor:reviews')!.fire()).resolves.toBeUndefined();
    });
  });

  it('a direct refresh still RESOLVES — only the ticker learns about failure', async () => {
    const { result } = await mountMeasured();
    mockReviewCounts.mockRejectedValue(new Error('database is locked'));
    mockListReviewsPage.mockRejectedValue(new Error('database is locked'));

    await act(async () => {
      await expect(result.current.refreshAttention()).resolves.toBeUndefined();
    });
  });
});

describe('a hidden Monitor costs nothing', () => {
  function Probe({ feeds }: { feeds: MonitorFeeds }) {
    useMonitorData(feeds);
    return null;
  }
  function Overlay({ visible }: { visible: boolean }) {
    return (
      <MonitorVisibilityContext.Provider value={visible}>
        <Probe feeds={MONITOR_FEEDS} />
      </MonitorVisibilityContext.Provider>
    );
  }

  const monitorTickers = () =>
    [...tickers.values()].filter((t) => t.name?.startsWith('monitor:'));

  it('disables every monitor-owned ticker while it is off screen', async () => {
    const view = render(<Overlay visible />);
    await waitFor(() => expect(mockGetSummaries).toHaveBeenCalled());
    expect(monitorTickers().some((t) => t.enabled)).toBe(true);

    await act(async () => { view.rerender(<Overlay visible={false} />); });
    expect(monitorTickers().every((t) => !t.enabled)).toBe(true);
  });

  it('fires nothing while hidden, however long it stays hidden', async () => {
    const view = render(<Overlay visible />);
    await waitFor(() => expect(mockGetSummaries).toHaveBeenCalled());
    await act(async () => { view.rerender(<Overlay visible={false} />); });
    const reads = mockReviewCounts.mock.calls.length;

    advance(10 * 60_000);
    await act(async () => { await Promise.resolve(); });

    expect(mockReviewCounts.mock.calls.length).toBe(reads);
  });

  it('refreshes a STALE feed on reopen, without waiting out an interval', async () => {
    const view = render(<Overlay visible />);
    await waitFor(() => expect(mockReviewCounts).toHaveBeenCalledTimes(1));
    await act(async () => { view.rerender(<Overlay visible={false} />); });

    advance(10 * 60_000);
    await act(async () => { view.rerender(<Overlay visible />); });

    await waitFor(() => expect(mockReviewCounts).toHaveBeenCalledTimes(2));
  });

  it('does NOT re-read a feed that is still fresh — reopening is not a flush', async () => {
    const view = render(<Overlay visible />);
    await waitFor(() => expect(mockReviewCounts).toHaveBeenCalledTimes(1));

    await act(async () => { view.rerender(<Overlay visible={false} />); });
    advance(2_000);
    await act(async () => { view.rerender(<Overlay visible />); });
    await act(async () => { await Promise.resolve(); });

    expect(mockReviewCounts).toHaveBeenCalledTimes(1);
  });
});
