/**
 * The review write path.
 *
 * Two defects are pinned here, both of which let a decision vanish:
 *  1. A blanket `if (isProcessing) return;` DROPPED any verdict issued while
 *     another was in flight — no write, no error. A reviewer clearing a triage
 *     deck at one card per second hits that window constantly.
 *  2. Both writers swallowed every error, so a caller that resolves
 *     optimistically (the triage deck does) could never learn the write failed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- mocks (must precede the import under test) ----------------------------

const mockListReviews = vi.fn();
const mockUpdateStatus = vi.fn();
const mockDispatchAction = vi.fn();

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: (...args: unknown[]) => mockListReviews(...args),
  updateManualReviewStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  dispatchReviewAction: (...args: unknown[]) => mockDispatchAction(...args),
}));

vi.mock('@/api/overview/messages', () => ({
  listMessages: vi.fn().mockResolvedValue([]),
  markMessageRead: vi.fn().mockResolvedValue(undefined),
}));

/** Every poller registered this mount, by `name`, with its `enabled` flag. */
const registeredPollers: { name?: string; enabled: boolean }[] = [];

vi.mock('@/hooks/utility/timing/usePolling', () => ({
  usePolling: (_fn: unknown, opts: { enabled: boolean; name?: string }) => {
    registeredPollers.push({ name: opts.name, enabled: opts.enabled });
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
  cloudReviews: [],
  fetchCloudReviews: vi.fn().mockResolvedValue(undefined),
  respondToCloudReview: vi.fn().mockResolvedValue(undefined),
  fetchPendingReviewCount: vi.fn().mockResolvedValue(undefined),
  fetchUnreadMessageCount: vi.fn().mockResolvedValue(undefined),
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

// --- helpers ---------------------------------------------------------------

function row(id: string) {
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

/** Mount and wait for the initial review load to land. */
async function mount(feeds?: Parameters<typeof useMonitorData>[0]) {
  const hook = renderHook(() => useMonitorData(feeds));
  await waitFor(() => expect(hook.result.current.reviews.length).toBeGreaterThan(0));
  return hook;
}

/** The `enabled` flag of one named poller. */
const pollerEnabled = (name: string) =>
  registeredPollers.filter((p) => p.name === name).some((p) => p.enabled);

beforeEach(() => {
  vi.clearAllMocks();
  registeredPollers.length = 0;
  mockListReviews.mockResolvedValue([row('r1'), row('r2')]);
  mockUpdateStatus.mockResolvedValue(undefined);
  mockDispatchAction.mockResolvedValue(undefined);
});

// --- tests -----------------------------------------------------------------

describe('useMonitorData — concurrent verdicts', () => {
  it('writes BOTH verdicts when a second lands while the first is in flight', async () => {
    let releaseFirst!: () => void;
    mockUpdateStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
    );

    const { result } = await mount();

    // Issue the first verdict and let React re-render — that re-render is what
    // used to arm the `isProcessing` early-return...
    let first!: Promise<void>;
    await act(async () => { first = result.current.handleReviewAction('r1', 'approved'); });

    // ...so the SECOND verdict, issued from the re-rendered callback, was the
    // one silently dropped.
    let second!: Promise<void>;
    await act(async () => { second = result.current.handleReviewAction('r2', 'rejected'); });

    await act(async () => {
      releaseFirst();
      await Promise.all([first, second]);
    });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateStatus).toHaveBeenCalledWith('r1', 'approved', undefined);
    expect(mockUpdateStatus).toHaveBeenCalledWith('r2', 'rejected', undefined);
  });

  it('joins a repeat call for the SAME review instead of writing twice', async () => {
    let release!: () => void;
    mockUpdateStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const { result } = await mount();

    let a!: Promise<void>;
    let b!: Promise<void>;
    await act(async () => { a = result.current.handleReviewAction('r1', 'approved'); });
    await act(async () => { b = result.current.handleReviewAction('r1', 'approved'); });

    await act(async () => {
      release();
      await Promise.all([a, b]);
    });

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it('reports isProcessing while a write is open, and clears it after', async () => {
    let release!: () => void;
    mockUpdateStatus.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const { result } = await mount();
    expect(result.current.isProcessing).toBe(false);

    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleReviewAction('r1', 'approved'); });
    expect(result.current.isProcessing).toBe(true);

    await act(async () => { release(); await pending; });
    expect(result.current.isProcessing).toBe(false);
  });
});

describe('useMonitorData — no poller for data the surface cannot render', () => {
  it('polls all four feeds by default, so the Monitor is unchanged', async () => {
    await mount();
    expect(pollerEnabled('monitor:reviews')).toBe(true);
    expect(pollerEnabled('monitor:messages')).toBe(true);
    expect(pollerEnabled('monitor:personaHealth')).toBe(true);
    // Cloud is gated on the connection, not on the feed set.
    expect(registeredPollers.some((p) => p.name === 'monitor:cloudReviews')).toBe(true);
  });

  it('starts NO message or health poller for a surface that renders neither', async () => {
    // The triage deck: `usePendingInteractions` does not even return
    // `unreadMessages`, yet opening the deck used to run a list_messages(300)
    // query and a fetchPersonaSummaries() every 30 seconds for its whole life.
    await mount({ messages: false, personaHealth: false });
    expect(pollerEnabled('monitor:reviews')).toBe(true);
    expect(pollerEnabled('monitor:messages')).toBe(false);
    expect(pollerEnabled('monitor:personaHealth')).toBe(false);
  });

  it('never even fetches messages once when they are not wanted', async () => {
    const { listMessages } = await import('@/api/overview/messages');
    await mount({ messages: false, personaHealth: false });
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('still fills a COLD persona roster once — the review cards need the names', async () => {
    // Skipping the poll must not cost the deck persona identity: with an empty
    // store there would be no name to join onto a review at all.
    expect(agentState.personas).toHaveLength(0);
    await mount({ messages: false, personaHealth: false });
    expect(agentState.fetchPersonaSummaries).toHaveBeenCalledTimes(1);
  });
});

describe('useMonitorData — failures are surfaced, not swallowed', () => {
  it('rejects when the review write fails', async () => {
    mockUpdateStatus.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = await mount();

    await expect(result.current.handleReviewAction('r1', 'approved')).rejects.toThrow(
      'database is locked',
    );
  });

  it('rejects when the dispatch write fails', async () => {
    mockDispatchAction.mockRejectedValueOnce(new Error('no runner'));
    const { result } = await mount();

    await expect(result.current.handleDispatchAction('r1', 'rotate the key')).rejects.toThrow(
      'no runner',
    );
  });

  it('rejects rather than no-oping when the review is no longer pending', async () => {
    const { result } = await mount();

    await expect(result.current.handleReviewAction('ghost', 'approved')).rejects.toThrow(
      /no longer in the pending queue/,
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});
