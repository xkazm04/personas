/**
 * A NEW MESSAGE LIGHTS THE TILE ON THE EVENT, NOT THE POLL.
 *
 * Rust emits `report-created` the instant a report row lands, and the app has
 * had a singleton listener for it since the Overview report list was built —
 * but the Monitor's only path to a new message was a 30s `list_reports(300)`
 * poll, so a tile could sit dark for half a minute after the message that
 * should have lit it was already in SQLite.
 *
 * These tests drive the REAL singleton listener (only Tauri's `listen` is
 * mocked), so they also pin the two things layering on a shared subscription
 * can get wrong: releasing it on unmount, and doing work for a surface that
 * does not render messages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';

// --- mocks (must precede the import under test) ----------------------------

type Handler = (event: { payload: PersonaReport }) => void;
const handlers: Handler[] = [];
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, cb: Handler) => {
    handlers.push(cb);
    return unlisten;
  }),
}));

const mockListReports = vi.fn();
const mockListReviews = vi.fn();

vi.mock('@/api/overview/reports', () => ({
  listReports: (...a: unknown[]) => mockListReports(...a),
  markReportRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...a: unknown[]) => mockListReviews(...a),
  listManualReviewsPage: vi.fn(),
  updateManualReviewStatus: vi.fn(),
  dispatchReviewAction: vi.fn(),
}));

vi.mock('@/api/system/cloud', () => ({ cloudRespondToReview: vi.fn() }));

/** Registered tickers — asserted NEVER to be the thing that delivered a message. */
const pollers = new Map<string, () => unknown>();
vi.mock('@/hooks/utility/timing/usePolling', () => ({
  usePolling: (fn: () => unknown, opts: { enabled: boolean; name?: string }) => {
    if (opts.enabled && opts.name) pollers.set(opts.name, fn);
    return { isPolling: opts.enabled, lastRefreshed: null };
  },
  POLLING_CONFIG: {
    dashboardRefresh: { interval: 60_000 },
    cloudReviews: { interval: 60_000, maxBackoff: 60_000 },
  },
}));

vi.mock('@/lib/log', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const agentState = {
  personas: [],
  personaHealthMap: {},
  fetchPersonaSummaries: vi.fn().mockResolvedValue(undefined),
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

import { useMonitorData } from './useMonitorData';

// --- fixtures --------------------------------------------------------------

function report(id: string, isRead = false): PersonaReport {
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

/** Deliver a payload the way the backend does, and let the per-frame flush run. */
async function emitReportCreated(payload: PersonaReport) {
  await act(async () => {
    for (const h of handlers) h({ payload });
    // The singleton coalesces a tick's payloads into one animation frame.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await Promise.resolve();
  });
}

async function mount(feeds?: Parameters<typeof useMonitorData>[0]) {
  const view = renderHook(() => useMonitorData(feeds));
  await waitFor(() => expect(mockListReviews).toHaveBeenCalled());
  // The Tauri `listen()` resolves a microtask later; nothing can be delivered
  // before the singleton has attached.
  await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.length = 0;
  pollers.clear();
  mockListReviews.mockResolvedValue([]);
  mockListReports.mockResolvedValue([report('m1')]);
});

describe('useMonitorData — report-created lights the tile immediately', () => {
  it('refreshes the unread set on the event, with no poll tick', async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.unreadMessages).toHaveLength(1));

    mockListReports.mockResolvedValue([report('m1'), report('m2')]);
    const pollCallsBefore = mockListReports.mock.calls.length;

    await emitReportCreated(report('m2'));

    await waitFor(() => expect(result.current.unreadMessages).toHaveLength(2));
    expect(mockListReports.mock.calls.length).toBeGreaterThan(pollCallsBefore);
    // Nothing ticked: the poller function was never invoked in this test.
    expect(pollers.has('monitor:messages')).toBe(true);
  });

  it('keeps the 30s poll as the fallback', async () => {
    await mount();
    // The event path is an ADDITION — the ticker is still registered and still
    // enabled, so anything the event misses is picked up within a cadence.
    expect(pollers.has('monitor:messages')).toBe(true);
  });

  it('does no work at all for a surface that does not render messages', async () => {
    const { result } = await mount({ messages: false, personaHealth: false });
    expect(mockListReports).not.toHaveBeenCalled();
    // Whatever the module-scoped warm cache is holding, the event must not move
    // it — the assertion is "no work", not "no data".
    const before = result.current.unreadMessages;

    await emitReportCreated(report('m2'));

    expect(mockListReports).not.toHaveBeenCalled();
    expect(result.current.unreadMessages).toBe(before);
  });

  it('releases the subscription on unmount', async () => {
    const { unmount } = await mount();
    expect(unlisten).not.toHaveBeenCalled();

    unmount();
    // The singleton tears the Tauri listener down once its last subscriber
    // leaves — otherwise every Monitor open would leak one.
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  it('coalesces a burst into at most two reads', async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.unreadMessages).toHaveLength(1));

    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockListReports.mockImplementation(async () => {
      await gate;
      return [report('m1'), report('m2')];
    });
    const before = mockListReports.mock.calls.length;

    // A persona finishing a fan-out emits a dozen of these in one tick.
    await act(async () => {
      for (const h of handlers) {
        for (let i = 0; i < 6; i += 1) h({ payload: report(`burst-${i}`) });
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.unreadMessages).toHaveLength(2));

    // One read in flight + one guaranteed to see everything the burst wrote.
    expect(mockListReports.mock.calls.length - before).toBeLessThanOrEqual(2);
  });
});
