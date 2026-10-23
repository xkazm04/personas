/**
 * `Sidebar` and its child `SidebarLevel1` both call `useBadgeCounts` and are
 * always mounted together. When each call owned its own ticker, the 30 s bucket
 * held two `sidebarBadges` tickers and every tick issued the badge reads twice.
 * These pin one driver for N consumers: one registration, one portfolio read
 * per tick, one shared director count, and a stop only when the last leaves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const registerMock = vi.fn();
const disposeMock = vi.fn();
const portfolioMock = vi.fn();
const recentEventsMock = vi.fn();
const budgetMock = vi.fn();

vi.mock('@/lib/polling/pollingCoordinator', () => ({
  getPollingCoordinator: () => ({ register: registerMock }),
}));
vi.mock('@/api/director', () => ({
  getDirectorPortfolio: () => portfolioMock(),
}));
vi.mock('@/features/companions/overseer/attention', () => ({
  flaggedAgentCount: (roster: unknown[]) => roster.length,
}));
vi.mock('@/hooks/useAttention', () => ({
  useAttention: () => ({
    counts: { pending_reviews: 1, unread_reports: 2, pending_events: 3, open_incidents: 4 },
  }),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: {
    getState: () => ({
      fetchRecentEvents: recentEventsMock,
      pendingReviewCount: 0,
      unreadReportCount: 0,
    }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/agentStore', () => {
  const state = { fetchBudgetSpend: (...a: unknown[]) => budgetMock(...a) };
  const useAgentStore = (sel: (s: typeof state) => unknown) => sel(state);
  useAgentStore.getState = () => state;
  return { useAgentStore };
});
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: {
    getState: () => ({ pendingCounts: null }),
    subscribe: () => () => {},
  },
}));

import { useBadgeCounts } from '../useBadgeCounts';

async function settle() {
  await act(async () => {
    // The driver reaches the coordinator through a dynamic import, which
    // vitest resolves on a later macrotask than a bare microtask drain.
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe('useBadgeCounts — one polling driver for every consumer', () => {
  beforeEach(() => {
    registerMock.mockReset();
    disposeMock.mockReset();
    registerMock.mockReturnValue({ dispose: disposeMock });
    portfolioMock.mockReset();
    portfolioMock.mockResolvedValue({ roster: [{}, {}] });
    recentEventsMock.mockReset();
    recentEventsMock.mockResolvedValue(undefined);
    budgetMock.mockReset();
    budgetMock.mockResolvedValue(undefined);
  });

  it('registers one ticker for two mounted consumers and shares its director count', async () => {
    const sidebar = renderHook(() => useBadgeCounts());
    const level1 = renderHook(() => useBadgeCounts());
    await vi.waitFor(() => expect(registerMock).toHaveBeenCalled());
    await settle();

    expect(registerMock).toHaveBeenCalledTimes(1);

    // Drive one tick of the registered fetch: three reads, once each.
    const tick = registerMock.mock.calls[0]![1] as () => Promise<void>;
    await act(async () => {
      await tick();
    });
    await settle();
    expect(portfolioMock).toHaveBeenCalledTimes(1);
    expect(recentEventsMock).toHaveBeenCalledTimes(1);
    expect(budgetMock).toHaveBeenCalledTimes(1);

    expect(sidebar.result.current.directorAttentionCount).toBe(2);
    expect(level1.result.current.directorAttentionCount).toBe(2);
    expect(level1.result.current.pendingReviewCount).toBe(1);

    level1.unmount();
    expect(disposeMock).not.toHaveBeenCalled();
    sidebar.unmount();
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it('starts again after the last consumer left', async () => {
    const first = renderHook(() => useBadgeCounts());
    await vi.waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useBadgeCounts());
    await vi.waitFor(() => expect(registerMock).toHaveBeenCalledTimes(2));

    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    second.unmount();
    expect(disposeMock).toHaveBeenCalledTimes(2);
  });
});
