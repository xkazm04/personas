/**
 * THE SECOND MONITOR ENGINE — the duplicate this arrangement exists to prevent.
 *
 * Opening Activity mounted `useMonitorData` twice. The overlay shell mounts one
 * in badge mode; a second arrived down a chain nobody reads end to end
 * (`useRailSurface` → `useRailFeeds.useReviewFeed` → `useUnifiedTriage` →
 * `usePendingInteractions` → `useMonitorData(DECK_FEEDS)`), with its own 30s
 * review poll and its own 15s cloud poll, running whenever the Activity
 * surface was mounted — regardless of whether the rail was open or even on the
 * reviews tab.
 *
 * The fix is a provider: the overlay shares its one engine and
 * `usePendingInteractions` consumes it. The dangerous half is the FALLBACK,
 * because the Quick Answer popover reaches the same hook from outside the
 * overlay and must keep an engine of its own. Hooks cannot be called
 * conditionally, so the second instance is ALWAYS MOUNTED and `dormant` is the
 * only thing that makes it cost nothing — and getting that backwards restores
 * the exact duplicate with no crash, no warning and no visible symptom.
 *
 * So the two halves are measured here rather than described: how many engines
 * are live, and what each of them actually asked the backend for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// --- mocks (must precede the import under test) ----------------------------

const mockListReviews = vi.fn();
const mockListReviewsPage = vi.fn();
const mockReviewCounts = vi.fn();
const mockListReports = vi.fn();
const mockMessageCounts = vi.fn();

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: (...a: unknown[]) => mockListReviewsPage(...a),
  getPendingReviewCountsByPersona: (...a: unknown[]) => mockReviewCounts(...a),
  updateManualReviewStatus: vi.fn(),
  dispatchReviewAction: vi.fn(),
}));

vi.mock('@/api/overview/reports', () => ({
  listReports: (...a: unknown[]) => mockListReports(...a),
  getUnreadReportCountsByPersona: (...a: unknown[]) => mockMessageCounts(...a),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/system/cloud', () => ({
  cloudRespondToReview: vi.fn(),
}));

vi.mock('@/api/agents/buildSession', () => ({
  answerBuildQuestion: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Every LIVING ticker, keyed by the `usePolling` call site that owns it.
 *
 * Keyed rather than appended: a hook re-renders, and a list of registrations
 * counts renders where the question is how many INSTANCES exist. The id rides
 * on a ref, so it is the identity of the call site across its whole life.
 */
const tickers = new Map<number, { name?: string; enabled: boolean }>();
let nextTickerId = 0;
vi.mock('@/hooks/utility/timing/usePolling', async () => {
  const { useRef } = await import('react');
  return {
    usePolling: (_fn: unknown, opts: { enabled: boolean; name?: string }) => {
      const id = useRef<number | null>(null);
      if (id.current === null) id.current = ++nextTickerId;
      tickers.set(id.current, { name: opts.name, enabled: opts.enabled });
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

const agentState = {
  personas: [] as unknown[],
  personaHealthMap: {},
  buildSessions: {},
  applyPendingAnswers: vi.fn(),
  fetchPersonaSummaries: vi.fn().mockResolvedValue(undefined),
  personaSummariesError: null,
  personaSummariesRefreshedAt: null,
};
const overviewState = {
  activeProcesses: {},
  cloudReviews: [] as unknown[],
  fetchCloudReviews: vi.fn().mockResolvedValue(undefined),
  fetchPendingReviewCount: vi.fn().mockResolvedValue(undefined),
  fetchUnreadReportCount: vi.fn().mockResolvedValue(undefined),
};
const systemState = { cloudConfig: { is_connected: false } };

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof overviewState) => unknown) => sel(overviewState),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

import { usePendingInteractions } from '@/features/agents/quick-answer/usePendingInteractions';
import { MonitorDataProvider } from './monitorDataContext';
import { MONITOR_REVIEW_LIMIT, useMonitorData, type MonitorFeeds } from './useMonitorData';

// --- harness ---------------------------------------------------------------

/** Exactly what `PersonaMonitor` asks for on the Activity board. */
const SHELL_FEEDS: MonitorFeeds = {
  reviews: true,
  messages: true,
  personaHealth: true,
  badgeCounts: true,
  reviewLimit: MONITOR_REVIEW_LIMIT,
};

/** The overlay: one engine, published to everything under it. */
function Shell({ children }: { children: ReactNode }) {
  const data = useMonitorData(SHELL_FEEDS);
  return <MonitorDataProvider data={data}>{children}</MonitorDataProvider>;
}

/** How many `useMonitorData` instances exist, and how many are doing work. */
function engines() {
  const all = [...tickers.values()].filter((r) => r.name === 'monitor:reviews');
  return { mounted: all.length, live: all.filter((r) => r.enabled).length };
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
    assignment_id: null,
    step_id: null,
    use_case_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tickers.clear();
  mockListReviews.mockResolvedValue([review('r1')]);
  mockListReviewsPage.mockResolvedValue({ rows: [review('r1')], hasMore: false });
  mockReviewCounts.mockResolvedValue([
    { personaId: 'p1', pending: 1, critical: 0, warning: 1, info: 0 },
  ]);
  mockListReports.mockResolvedValue([]);
  mockMessageCounts.mockResolvedValue({});
});

describe('inside the Monitor: the second engine never wakes up', () => {
  it('runs exactly ONE live engine with the rail consuming it', async () => {
    renderHook(() => usePendingInteractions(), { wrapper: Shell });
    await waitFor(() => expect(mockListReviewsPage).toHaveBeenCalled());

    // Two instances are MOUNTED — a hook cannot be called conditionally — and
    // exactly one of them polls. That second number is the whole fix.
    expect(engines().mounted).toBe(2);
    expect(engines().live).toBe(1);
  });

  it('asks the backend for the review page exactly ONCE', async () => {
    renderHook(() => usePendingInteractions(), { wrapper: Shell });
    await waitFor(() => expect(mockListReviewsPage).toHaveBeenCalled());

    expect(mockListReviewsPage).toHaveBeenCalledTimes(1);
    expect(mockListReviewsPage).toHaveBeenCalledWith({
      status: 'pending',
      limit: MONITOR_REVIEW_LIMIT,
    });
  });

  it('registers ONE cloud ticker, not two', async () => {
    renderHook(() => usePendingInteractions(), { wrapper: Shell });
    await waitFor(() => expect(mockListReviewsPage).toHaveBeenCalled());

    const cloud = [...tickers.values()].filter((r) => r.name === 'monitor:cloudReviews');
    expect(cloud.length).toBe(2);
    expect(cloud.filter((r) => r.enabled).length).toBe(0); // not connected
  });

  it('serves the rail the rows of the SHARED engine, not an empty queue', async () => {
    const { result } = renderHook(() => usePendingInteractions(), { wrapper: Shell });
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));

    // The shell runs in BADGE mode. Counts and rows used to be exclusive, so a
    // rail reading a badge-mode engine would have been handed nothing at all
    // while the tiles badged a number.
    expect(result.current.reviews[0]!.id).toBe('r1');
    expect(mockReviewCounts).toHaveBeenCalledTimes(1);
  });
});

describe('outside the Monitor: the popover keeps its own engine', () => {
  it('mounts ONE engine and it is LIVE — there is no provider to borrow from', async () => {
    renderHook(() => usePendingInteractions());
    await waitFor(() => expect(mockListReviewsPage).toHaveBeenCalled());

    expect(engines().mounted).toBe(1);
    expect(engines().live).toBe(1);
  });

  it('still reads the capped review page for itself', async () => {
    const { result } = renderHook(() => usePendingInteractions());
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));

    expect(mockListReviewsPage).toHaveBeenCalledWith({
      status: 'pending',
      limit: MONITOR_REVIEW_LIMIT,
    });
    // No counts read: the popover does not badge tiles.
    expect(mockReviewCounts).not.toHaveBeenCalled();
  });

  it('resolves its own loading state — a dormant engine would hang here forever', async () => {
    const { result } = renderHook(() => usePendingInteractions());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

describe('a dormant engine costs nothing', () => {
  it('runs no poller, no mount read and no roster fill', async () => {
    renderHook(() => useMonitorData({ dormant: true, reviewLimit: MONITOR_REVIEW_LIMIT }));
    // Nothing to wait FOR, so wait for the thing that would prove a leak: a
    // flushed microtask queue with still no backend traffic.
    await waitFor(() => expect(tickers.size).toBeGreaterThan(0));

    expect([...tickers.values()].every((r) => !r.enabled)).toBe(true);
    expect(mockListReviews).not.toHaveBeenCalled();
    expect(mockListReviewsPage).not.toHaveBeenCalled();
    expect(mockReviewCounts).not.toHaveBeenCalled();
    expect(mockListReports).not.toHaveBeenCalled();
    expect(agentState.fetchPersonaSummaries).not.toHaveBeenCalled();
  });

  it('reports loading false rather than a ghost nothing will ever end', () => {
    const { result } = renderHook(() => useMonitorData({ dormant: true }));
    expect(result.current.loading).toBe(false);
  });
});
