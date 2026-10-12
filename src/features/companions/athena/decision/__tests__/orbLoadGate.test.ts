/**
 * An empty queue costs the orb ONLY the shared counts read.
 *
 * The orb is mounted for the whole session. It loads roster ITEMS — which
 * mounts the triage deck's machinery (gates) or the incident list (incidents)
 * — only while the counts it already gets say something it could surface is
 * waiting. Driven through the real `DecisionDriver` and the real roster, with
 * the triage hook and the incident list as spies.
 */
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { incidentRow, pendingCounts } from '@/features/decision-center/__tests__/rosterFixtures';
import { resetDecisionSourceCache } from '@/features/decision-center/roster/useDecisionSources';
import { resetPendingCountsSource } from '@/features/decision-center/roster/pendingCountsSource';
import { useSystemStore } from '@/stores/systemStore';

import { useAthenaStore } from '../../athenaStore';
import { orbLoad } from '../orbLoad';

const mockUnifiedTriage = vi.fn();
const mockListIncidents = vi.fn();

vi.mock('@/features/agents/quick-answer/triage/useUnifiedTriage', () => ({
  useUnifiedTriage: (...a: unknown[]) => {
    mockUnifiedTriage(...a);
    return { sources: [], ports: {}, failures: [], loading: false, revalidate: vi.fn() };
  },
}));
vi.mock('@/api/overview/incidents', () => ({
  listAuditIncidents: (...a: unknown[]) => mockListIncidents(...a),
  resolveAuditIncident: vi.fn(),
  dismissAuditIncident: vi.fn(),
  acknowledgeAuditIncident: vi.fn(),
  setIncidentInProgress: vi.fn(),
}));
vi.mock('@/features/decision-center/roster/useRosterRefresh', async (orig) => ({
  ...(await orig<typeof import('@/features/decision-center/roster/useRosterRefresh')>()),
  useRosterRefresh: () => undefined,
}));
vi.mock('@/features/decision-center/roster/useChatThreads', () => ({
  useChatThreads: () => ({ count: 0, items: [], failed: false, markSeen: vi.fn() }),
}));
vi.mock('@/features/decision-center/roster/useDecisionCopy', async () => {
  const { DEFAULT_DECISION_COPY } = await import('@/features/decision-center/roster/decisionCopy');
  return { useDecisionCopy: () => DEFAULT_DECISION_COPY };
});
vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListPendingApprovals: vi.fn(async () => []),
    companionListProactiveMessages: vi.fn(async () => []),
  };
});
vi.mock('@/api/fleet/claudeAccounts', () => ({
  listClaudeAccounts: vi.fn(async () => ({ accounts: [] })),
  reloginClaudeAccount: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('@/lib/eventRegistry', async (orig) => ({
  ...(await orig<typeof import('@/lib/eventRegistry')>()),
  typedListen: vi.fn(async () => () => undefined),
}));

import { DecisionDriver } from '../useDecisionQueue';

const ZERO = pendingCounts({
  goalAcceptance: 0,
  manualReviews: 0,
  ideas: 0,
  policyProposals: 0,
  promotionProposals: 0,
  openIncidents: 0,
  blockingIncidents: 0,
  unreadReports: 0,
  companionApprovals: 0,
  councilDecidable: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetDecisionSourceCache();
  resetPendingCountsSource();
  useAthenaStore.getState().clearPendingDecision();
  mockListIncidents.mockResolvedValue([incidentRow({ severity: 'critical' })]);
});

describe('orbLoad', () => {
  it('loads nothing before the first read and nothing on zero', () => {
    expect(orbLoad(null, false)).toEqual([]);
    expect(orbLoad(ZERO, false)).toEqual([]);
  });

  it('loads exactly the chips with orb-decidable work', () => {
    expect(orbLoad({ ...ZERO, companionApprovals: 1 }, false)).toEqual(['gates']);
    expect(orbLoad({ ...ZERO, manualReviews: 2 }, false)).toEqual(['gates']);
    // Open but not blocking: not the orb's, so no incident list.
    expect(orbLoad({ ...ZERO, openIncidents: 3 }, false)).toEqual([]);
    expect(orbLoad({ ...ZERO, openIncidents: 3, blockingIncidents: 1 }, false)).toEqual(['incidents']);
    // Backlog, proposals, reports, council: the hub's, not the orb's.
    expect(orbLoad({ ...ZERO, ideas: 9, unreadReports: 4, councilDecidable: 1 }, false)).toEqual([]);
  });

  it('loads both when the counts read failed — it cannot prove the queue empty', () => {
    expect(orbLoad(null, true)).toEqual(['gates', 'incidents']);
  });
});

describe('DecisionDriver', () => {
  it('with zero counts fetches no item at all', async () => {
    useSystemStore.setState({ pendingCounts: ZERO });

    render(createElement(DecisionDriver));
    // Give any effect a chance to fire a fetch.
    await new Promise((r) => setTimeout(r, 20));

    expect(mockUnifiedTriage).not.toHaveBeenCalled();
    expect(mockListIncidents).not.toHaveBeenCalled();
  });

  it('mounts the roster for blocking incidents only, and surfaces one', async () => {
    useSystemStore.setState({ pendingCounts: { ...ZERO, openIncidents: 1, blockingIncidents: 1 } });

    render(createElement(DecisionDriver));

    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe('incident:inc-1'));
    expect(mockListIncidents).toHaveBeenCalled();
    // The roster is mounted, but the gates chip is not loaded: the deck's
    // owned fetches stay off.
    expect(mockUnifiedTriage.mock.calls.every((c) => (c[2] as { enabled: boolean }).enabled === false)).toBe(true);
  });

  it('loads gates when an approval is waiting', async () => {
    useSystemStore.setState({ pendingCounts: { ...ZERO, companionApprovals: 1 } });

    render(createElement(DecisionDriver));

    await waitFor(() =>
      expect(mockUnifiedTriage.mock.calls.some((c) => (c[2] as { enabled: boolean }).enabled)).toBe(true),
    );
    expect(mockListIncidents).not.toHaveBeenCalled();
  });
});
