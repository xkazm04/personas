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

vi.mock('@/hooks/utility/timing/usePolling', () => ({
  usePolling: () => {},
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
async function mount() {
  const hook = renderHook(() => useMonitorData());
  await waitFor(() => expect(hook.result.current.reviews.length).toBeGreaterThan(0));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
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
