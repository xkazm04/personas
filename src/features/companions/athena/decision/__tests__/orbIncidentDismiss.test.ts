/**
 * A failed incident write on the orb is a failure, not a resolution.
 *
 * Recorded deviation (`plugins-companion-decision`): the orb's incident
 * "dismiss" caught a failed `companionDismissProactive` and swallowed it, so
 * `runDecisionOption` recorded `decision_resolved` and cleared the bubble while
 * the row stayed pending. The orb's incidents are now the roster's incidents,
 * and Dismiss writes through the roster's incident door (`resolveIncidentRow`),
 * which REJECTS — driven here through the real roster down to the API mock.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { incidentRow, pendingCounts, rejectionOf } from '@/features/decision-center/__tests__/rosterFixtures';
import { resetPendingCountsSource } from '@/features/decision-center/roster/pendingCountsSource';
import { resetDecisionSourceCache } from '@/features/decision-center/roster/useDecisionSources';
import { useDecisionRoster } from '@/features/decision-center/useDecisionRoster';

import { useAthenaStore } from '../../athenaStore';
import { resetDecisionDeferrals } from '../decisionDeferral';
import { runDecisionOption } from '../resolveDecision';
import { buildDecisionQueueForTest } from '../useDecisionQueue';

const mockDismiss = vi.fn();
const mockDismissReminder = vi.fn();
const mockPendingCounts = vi.fn();

vi.mock('@/api/devTools/devTools', async (orig) => ({
  ...(await orig<typeof import('@/api/devTools/devTools')>()),
  pendingCounts: () => mockPendingCounts(),
}));

vi.mock('@/api/overview/incidents', () => ({
  listAuditIncidents: vi.fn(async () => [incidentRow({ severity: 'critical', status: 'open' })]),
  resolveAuditIncident: vi.fn(),
  dismissAuditIncident: (...a: unknown[]) => mockDismiss(...a),
  acknowledgeAuditIncident: vi.fn(),
  setIncidentInProgress: vi.fn(),
}));
vi.mock('@/features/agents/quick-answer/triage/useUnifiedTriage', () => ({
  useUnifiedTriage: () => ({ sources: [], ports: {}, failures: [], loading: false, revalidate: vi.fn() }),
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
    companionListProactiveMessages: vi.fn(async () => [
      { id: 'nudge-1', triggerKind: 'incident_blocker', triggerRef: 'inc-1', message: 'm', createdAt: 'x' },
    ]),
    companionDismissProactive: (...a: unknown[]) => mockDismissReminder(...a),
    companionRecordUxSignal: vi.fn(),
  };
});
vi.mock('@/api/fleet/claudeAccounts', () => ({
  listClaudeAccounts: vi.fn(async () => ({ accounts: [] })),
  reloginClaudeAccount: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetDecisionSourceCache();
  resetDecisionDeferrals();
  resetPendingCountsSource();
  useAthenaStore.getState().clearPendingDecision();
  // After the verdict, the last blocker is gone.
  mockPendingCounts.mockResolvedValue(pendingCounts({ blockingIncidents: 0 }));
  mockDismissReminder.mockResolvedValue(undefined);
});

async function incidentDecision() {
  const roster = renderHook(() => useDecisionRoster({ load: ['incidents'] }));
  await waitFor(() => expect(roster.result.current.items).toHaveLength(1));
  const queue = await buildDecisionQueueForTest({
    items: roster.result.current.items,
    decide: roster.result.current.decide,
  });
  const decision = queue[0]!;
  const dismiss = decision.options.find((o) => o.key === 'dismiss')!;
  return { roster, decision, dismiss };
}

describe('orb incident Dismiss', () => {
  it('writes the dismissal through the incident door', async () => {
    mockDismiss.mockResolvedValue(true);
    const { roster, dismiss } = await incidentDecision();

    await act(async () => {
      await dismiss.run();
    });

    expect(mockDismiss).toHaveBeenCalledWith('inc-1', undefined);
    expect(roster.result.current.items).toHaveLength(0);
    // The last blocker settled: Athena's incident reminder goes with it.
    await waitFor(() => expect(mockDismissReminder).toHaveBeenCalledWith('nudge-1'));
  });

  it('keeps the reminder while an incident still blocks', async () => {
    mockDismiss.mockResolvedValue(true);
    mockPendingCounts.mockResolvedValue(pendingCounts({ blockingIncidents: 2 }));
    const { dismiss } = await incidentDecision();

    await act(async () => {
      await dismiss.run();
    });
    await waitFor(() => expect(mockPendingCounts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));

    expect(mockDismissReminder).not.toHaveBeenCalled();
  });

  it('propagates a failed write instead of swallowing it', async () => {
    mockDismiss.mockRejectedValue(new Error('database is locked'));
    const { roster, dismiss } = await incidentDecision();

    let caught: unknown;
    await act(async () => {
      caught = await rejectionOf(Promise.resolve(dismiss.run()));
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('database is locked');
    // The roster put the incident back: it is still waiting — and no reminder
    // is swept on a verdict that never landed.
    expect(roster.result.current.items.map((i) => i.id)).toEqual(['incident:inc-1']);
    expect(mockDismissReminder).not.toHaveBeenCalled();
  });

  it('keeps the bubble up with its error when the write fails', async () => {
    mockDismiss.mockRejectedValue(new Error('database is locked'));
    const { decision, dismiss } = await incidentDecision();
    useAthenaStore.getState().setPendingDecision(decision);

    await act(async () => {
      await runDecisionOption(dismiss);
    });

    expect(useAthenaStore.getState().pendingDecision?.id).toBe(decision.id);
    expect(useAthenaStore.getState().decisionError).toBe('run-failed');
  });
});
