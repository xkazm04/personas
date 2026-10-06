/**
 * The roster's honesty properties, at the hook seam: a verdict whose write
 * fails puts the item BACK (and the rejection reaches the caller), a lost
 * compare-and-swap does not, and a counts read that failed is reported as
 * failed rather than as zero.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDecisionConflict } from '@/lib/decisions/rowWrites';
import { useSystemStore } from '@/stores/systemStore';

import { incidentRow, pendingCounts, rejectionOf } from './rosterFixtures';

const mockListIncidents = vi.fn();
const mockResolveIncident = vi.fn();
const mockPendingCounts = vi.fn();
const mockUndispatched = vi.fn();

vi.mock('@/api/overview/incidents', () => ({
  listAuditIncidents: (...a: unknown[]) => mockListIncidents(...a),
  resolveAuditIncident: (...a: unknown[]) => mockResolveIncident(...a),
  dismissAuditIncident: vi.fn(),
  acknowledgeAuditIncident: vi.fn(),
  setIncidentInProgress: vi.fn(),
}));
vi.mock('@/api/devTools/devTools', async (orig) => ({
  ...(await orig<typeof import('@/api/devTools/devTools')>()),
  pendingCounts: () => mockPendingCounts(),
  undispatchedIdeas: () => mockUndispatched(),
}));

// The triage deck's sources are another package's machinery; the roster only
// reads `sources`, `ports`, `failures`, `loading` and `revalidate` off it.
const triageStub = {
  sources: [],
  ports: {},
  failures: [],
  loading: false,
  revalidate: vi.fn(),
};
vi.mock('@/features/agents/quick-answer/triage/useUnifiedTriage', () => ({
  useUnifiedTriage: () => triageStub,
}));
vi.mock('../roster/useRosterRefresh', async (orig) => ({
  ...(await orig<typeof import('../roster/useRosterRefresh')>()),
  useRosterRefresh: () => undefined,
}));
const chatStub = { count: 0, items: [], failed: false, markSeen: vi.fn() };
vi.mock('../roster/useChatThreads', () => ({ useChatThreads: () => chatStub }));
vi.mock('../roster/useDecisionCopy', async () => {
  const { DEFAULT_DECISION_COPY } = await import('../roster/decisionCopy');
  return { useDecisionCopy: () => DEFAULT_DECISION_COPY };
});
vi.mock('@/features/companions/athena/applyClientAction', () => ({ applyClientAction: vi.fn() }));
vi.mock('@/features/companions/athena/athenaStore', () => ({
  useAthenaStore: { getState: () => ({ removeApproval: vi.fn() }) },
}));

import { useDecisionRoster } from '../useDecisionRoster';
import { resetDecisionSourceCache } from '../roster/useDecisionSources';
import { resetPendingCountsSource } from '../roster/pendingCountsSource';

beforeEach(() => {
  vi.clearAllMocks();
  resetDecisionSourceCache();
  resetPendingCountsSource();
  useSystemStore.setState({ pendingCounts: null, undispatchedIdeas: null });
  mockListIncidents.mockResolvedValue([incidentRow()]);
  mockPendingCounts.mockResolvedValue(pendingCounts());
  mockUndispatched.mockResolvedValue([]);
});

async function mountIncidents() {
  const hook = renderHook(() => useDecisionRoster({ load: ['incidents'] }));
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  return hook;
}

describe('useDecisionRoster — decide', () => {
  it('removes optimistically and RESTORES the item when the door rejects', async () => {
    const { result } = await mountIncidents();
    const target = result.current.items[0]!;
    let fail: (e: Error) => void = () => undefined;
    mockResolveIncident.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));

    let settled: Promise<void> = Promise.resolve();
    act(() => {
      settled = result.current.decide({ item: target, verdict: 'accept' });
    });
    // In flight: gone from the list (identity removal, not an index).
    expect(result.current.items).toHaveLength(0);
    expect(result.current.byChip.incidents).toEqual([]);

    await act(async () => {
      fail(new Error('database is locked'));
      await expect(settled).rejects.toThrow('database is locked');
    });
    expect(result.current.items.map((i) => i.id)).toEqual([target.id]);
  });

  it('keeps the item gone when the swap was lost, and still rethrows', async () => {
    const { result } = await mountIncidents();
    const target = result.current.items[0]!;
    // `false` from the incident command = somebody else got there first.
    mockResolveIncident.mockResolvedValueOnce(false);
    mockListIncidents.mockResolvedValue([incidentRow()]);

    let caught: unknown;
    await act(async () => {
      caught = await rejectionOf(result.current.decide({ item: target, verdict: 'accept' }));
    });
    expect(isDecisionConflict(caught)).toBe(true);
    expect(result.current.items.find((i) => i.id === target.id)).toBeUndefined();
  });

  it('a skip writes nothing and keeps the item', async () => {
    const { result } = await mountIncidents();
    await act(async () => {
      await result.current.decide({ item: result.current.items[0]!, verdict: 'skip' });
    });
    expect(mockResolveIncident).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
  });
});

describe('useDecisionRoster — counts', () => {
  it('reports a failed counts read as failed, never as zero', async () => {
    mockPendingCounts.mockRejectedValue(new Error('no db'));
    const { result } = renderHook(() => useDecisionRoster());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.counts.backlog.failed).toBe(true));
    expect(result.current.counts.incidents.failed).toBe(true);
    expect(result.current.counts.chat.failed).toBe(false);
  });

  it('maps a successful read onto the chips and the total', async () => {
    const { result } = renderHook(() => useDecisionRoster());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.counts.backlog.n).toBe(7));
    expect(result.current.counts.backlog.failed).toBe(false);
    expect(result.current.counts.incidents.lamp).toBe('danger');
    expect(result.current.total).toBe(4 + 3 + 7 + 3 + 1 + 4 + 0);
    // Nothing was asked for, so nothing loaded.
    expect(result.current.items).toEqual([]);
    expect(mockListIncidents).not.toHaveBeenCalled();
  });
});
