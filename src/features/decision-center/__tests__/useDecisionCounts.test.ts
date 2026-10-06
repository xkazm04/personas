/**
 * The counts-only reader and the roster are ONE aggregation: the title-bar
 * badge (`useDecisionCounts`) and the hub strip (`useDecisionRoster`) must name
 * the same total for the same store state, and N mounted readers must cost one
 * read per source, not N.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

import { pendingCounts } from './rosterFixtures';

const mockPendingCounts = vi.fn();
const mockUndispatched = vi.fn();

vi.mock('@/api/devTools/devTools', async (orig) => ({
  ...(await orig<typeof import('@/api/devTools/devTools')>()),
  pendingCounts: () => mockPendingCounts(),
  undispatchedIdeas: () => mockUndispatched(),
}));
vi.mock('@/features/agents/quick-answer/triage/useUnifiedTriage', () => ({
  useUnifiedTriage: () => ({ sources: [], ports: {}, failures: [], loading: false, revalidate: vi.fn() }),
}));
vi.mock('../roster/useRosterRefresh', async (orig) => ({
  ...(await orig<typeof import('../roster/useRosterRefresh')>()),
  useRosterRefresh: () => undefined,
}));
const chatStub = { count: 2, items: [], failed: false, markSeen: vi.fn() };
vi.mock('../roster/useChatThreads', () => ({ useChatThreads: () => chatStub }));
vi.mock('../roster/useDecisionCopy', async () => {
  const { DEFAULT_DECISION_COPY } = await import('../roster/decisionCopy');
  return { useDecisionCopy: () => DEFAULT_DECISION_COPY };
});
vi.mock('@/features/companions/athena/applyClientAction', () => ({ applyClientAction: vi.fn() }));

import { useDecisionRoster } from '../useDecisionRoster';
import { resetDecisionCountsSource, useDecisionCounts } from '../roster/useDecisionCounts';
import { resetDecisionSourceCache } from '../roster/useDecisionSources';
import { resetPendingCountsSource } from '../roster/pendingCountsSource';

/** One build session holding `n` questions — frontend state, no row anywhere. */
function questions(n: number) {
  return {
    'sess-1': { phase: 'awaiting_input', pendingQuestions: Array.from({ length: n }, (_, i) => i) },
  } as unknown as ReturnType<typeof useAgentStore.getState>['buildSessions'];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDecisionSourceCache();
  resetPendingCountsSource();
  resetDecisionCountsSource();
  useSystemStore.setState({ pendingCounts: null, undispatchedIdeas: null });
  useAgentStore.setState({ buildSessions: questions(3) });
  mockPendingCounts.mockResolvedValue(pendingCounts());
  mockUndispatched.mockResolvedValue([]);
});

describe('useDecisionCounts', () => {
  it('names the same total as the roster for the same state', async () => {
    const counts = renderHook(() => useDecisionCounts());
    const roster = renderHook(() => useDecisionRoster());
    act(() => counts.result.current.refreshCounts());
    await waitFor(() => expect(counts.result.current.counts.backlog.n).toBe(7));

    // gates 2 reviews + 2 approvals + 3 questions; proposals 1+1+1; backlog 7;
    // incidents 3; council 1; reports 4; chat 2.
    const expected = 7 + 3 + 7 + 3 + 1 + 4 + 2;
    expect(counts.result.current.total).toBe(expected);
    expect(roster.result.current.total).toBe(expected);
    expect(counts.result.current.counts).toEqual(roster.result.current.counts);
  });

  it('loads no items — the counts reader never asks a source for rows', async () => {
    const { result } = renderHook(() => useDecisionCounts());
    act(() => result.current.refreshCounts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.keys(result.current)).not.toContain('items');
  });

  it('costs one read per source however many readers refresh at once', async () => {
    const a = renderHook(() => useDecisionCounts());
    const b = renderHook(() => useDecisionCounts());
    const c = renderHook(() => useDecisionRoster());
    act(() => {
      a.result.current.refreshCounts();
      b.result.current.refreshCounts();
      c.result.current.refresh();
    });
    await waitFor(() => expect(a.result.current.counts.backlog.n).toBe(7));
    expect(mockPendingCounts).toHaveBeenCalledTimes(1);
    expect(mockUndispatched).toHaveBeenCalledTimes(1);
  });

  it('reports a failed read as failed on every chip it feeds, never as zero', async () => {
    mockPendingCounts.mockRejectedValue(new Error('no db'));
    const { result } = renderHook(() => useDecisionCounts());
    act(() => result.current.refreshCounts());
    await waitFor(() => expect(result.current.counts.gates.failed).toBe(true));
    expect(result.current.counts.incidents.failed).toBe(true);
    expect(result.current.counts.chat.failed).toBe(false);
  });
});
