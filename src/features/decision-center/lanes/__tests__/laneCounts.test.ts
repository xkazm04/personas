/**
 * The `decisionSurface` setting drives every counts reader without a reload:
 * under `chips` nothing reads the lanes snapshot; flipped to `lanes`, the same
 * mounted reader reads it once and names the lane total.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

import { pendingCounts } from '../../__tests__/rosterFixtures';

const mockPendingCounts = vi.fn();
const mockUndispatched = vi.fn();
const mockSnapshot = vi.fn();

vi.mock('@/api/devTools/devTools', async (orig) => ({
  ...(await orig<typeof import('@/api/devTools/devTools')>()),
  pendingCounts: () => mockPendingCounts(),
  undispatchedIdeas: () => mockUndispatched(),
}));
vi.mock('@/api/mandates', () => ({ getDecisionLanesSnapshot: () => mockSnapshot() }));
vi.mock('../../roster/useRosterRefresh', async (orig) => ({
  ...(await orig<typeof import('../../roster/useRosterRefresh')>()),
  useRosterRefresh: () => undefined,
}));
const chatStub = { count: 2, items: [], failed: false, markSeen: vi.fn() };
vi.mock('../../roster/useChatThreads', () => ({ useChatThreads: () => chatStub }));
vi.mock('../../roster/useDecisionCopy', async () => {
  const { DEFAULT_DECISION_COPY } = await import('../../roster/decisionCopy');
  return { useDecisionCopy: () => DEFAULT_DECISION_COPY };
});

import { resetDecisionCountsSource, useDecisionCounts } from '../../roster/useDecisionCounts';
import { resetPendingCountsSource } from '../../roster/pendingCountsSource';
import { resetLanesSnapshotSource } from '../lanesSnapshotSource';

const SNAP: DecisionLanesSnapshot = {
  items: [
    { itemId: 'review:1', itemKind: 'review', lane: 'breach', clause: 'unsigned', charterId: 'c1', coalesceKey: 'k', irreversible: null, projectId: 'p1' },
    { itemId: 'report:1', itemKind: 'report', lane: 'accept', clause: 'none', charterId: 'c1', coalesceKey: 'k', irreversible: null, projectId: 'p1' },
    { itemId: 'idea:9', itemKind: 'idea', lane: 'orphan', clause: 'none', charterId: null, coalesceKey: 'k', irreversible: null, projectId: 'p9' },
  ],
  charters: [],
  failedSources: [],
  generatedAt: '2026-10-14T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingCountsSource();
  resetDecisionCountsSource();
  resetLanesSnapshotSource();
  useSystemStore.setState({ pendingCounts: null, undispatchedIdeas: null, decisionSurface: 'chips' });
  useAgentStore.setState({ buildSessions: {} });
  mockPendingCounts.mockResolvedValue(pendingCounts());
  mockUndispatched.mockResolvedValue([]);
  mockSnapshot.mockResolvedValue(SNAP);
});

describe('lane counts under the decisionSurface setting', () => {
  it('reads nothing under chips, then the lane total once switched to lanes', async () => {
    const { result } = renderHook(() => useDecisionCounts());
    act(() => result.current.refreshCounts());
    await waitFor(() => expect(result.current.counts.backlog.n).toBe(7));
    expect(result.current.lanes).toBeNull();
    expect(result.current.laneTotal).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();

    act(() => useSystemStore.setState({ decisionSurface: 'lanes' }));
    await waitFor(() => expect(result.current.lanes?.accept.n).toBe(1));
    // breach 1 review; accept 1 report; talk 2 chat. Orphans are not in the total.
    expect(result.current.laneTotal).toBe(4);
    expect(result.current.lanes?.orphan.n).toBe(1);
    // The chip total is untouched by the switch.
    expect(result.current.total).toBeGreaterThan(0);
  });

  it('a failed snapshot read is failed, never zero', async () => {
    mockSnapshot.mockRejectedValue(new Error('no db'));
    useSystemStore.setState({ decisionSurface: 'lanes' });
    const { result } = renderHook(() => useDecisionCounts());
    await waitFor(() => expect(result.current.lanes?.breach.failed).toBe(true));
    expect(result.current.lanes?.talk.failed).toBe(false);
  });
});
