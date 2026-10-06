/**
 * The orb reads the Decision Center roster.
 *
 * Its approvals, blocking incidents and reviews are the roster's items, in the
 * roster's order, restricted to what the orb can decide hands-free — and the
 * behaviour contract survives the move: ONE pending decision at a time, the
 * queue re-pumps when the bubble frees, and a roster decision that was decided
 * elsewhere does not keep asking.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecisionItem } from '@/features/decision-center/model/decisionModel';
import {
  approvalToDecision,
  incidentToDecision,
  reportToDecision,
} from '@/features/decision-center/roster/decisionAdapters';
import { DEFAULT_DECISION_COPY } from '@/features/decision-center/roster/decisionCopy';
import {
  approvalRow,
  incidentRow,
  item,
  reportRow,
} from '@/features/decision-center/__tests__/rosterFixtures';

import { useAthenaStore } from '../../athenaStore';
import { resetDecisionDeferrals } from '../decisionDeferral';

const roster = {
  items: [] as DecisionItem[],
  decide: vi.fn(async () => undefined),
  errors: {} as { gates?: string; incidents?: string },
  loading: false,
};

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return { ...actual, companionListProactiveMessages: vi.fn(async () => []) };
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

import { buildDecisionQueueForTest, useDecisionQueue } from '../useDecisionQueue';

const c = DEFAULT_DECISION_COPY;
const approval = approvalToDecision(approvalRow(), 'low', c);
const report = reportToDecision(reportRow(), null, c);
// High, but already acknowledged: a person has seen it — the hub's, not the orb's.
const seenIncident = incidentToDecision(incidentRow({ id: 'inc-seen', status: 'acknowledged' }), c);
const review = item({ id: 'review:r-1', kind: 'review', title: 'Ship the patch?', weight: 60 });

beforeEach(() => {
  vi.clearAllMocks();
  resetDecisionDeferrals();
  useAthenaStore.getState().clearPendingDecision();
  roster.items = [];
  roster.loading = false;
  roster.errors = {};
});

describe('the orb queue over the roster', () => {
  it('pumps the roster\'s first ELIGIBLE item, one at a time', async () => {
    roster.items = [report, seenIncident, review, approval];

    renderHook(() => useDecisionQueue({ ...roster }));

    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe(approval.id));
    // The report and the acknowledged incident are not the orb's; the review
    // waits behind the tier-1 approval.
    expect(useAthenaStore.getState().decisionQueueDepth).toBe(2);
  });

  it('puts an open blocking incident in roster order — tier 1, ahead of a review', async () => {
    const blocker = incidentToDecision(incidentRow({ id: 'inc-open', severity: 'critical' }), c);
    const queue = await buildDecisionQueueForTest({ items: [review, blocker], decide: roster.decide });
    expect(queue.map((d) => d.id)).toEqual([blocker.id, review.id]);
    expect(queue[0]!.options.map((o) => o.key)).toEqual(['resolve', 'open', 'dismiss']);
  });

  it('routes every verdict through the roster\'s decide', async () => {
    const queue = await buildDecisionQueueForTest({ items: [approval], decide: roster.decide });
    await queue[0]!.options.find((o) => o.key === 'reject')!.run();
    expect(roster.decide).toHaveBeenCalledWith({ item: approval, verdict: 'reject' });
  });

  it('re-pumps the next item when the bubble frees', async () => {
    roster.items = [approval, review];
    renderHook(() => useDecisionQueue({ ...roster }));
    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe(approval.id));

    roster.items = [review];
    act(() => useAthenaStore.getState().clearPendingDecision());

    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe(review.id));
  });

  it('retires a bubble whose item was decided elsewhere', async () => {
    roster.items = [approval];
    const hook = renderHook(() => useDecisionQueue({ ...roster }));
    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe(approval.id));

    // The hub decided it; the roster's next read no longer holds it.
    roster.items = [];
    hook.rerender();

    await waitFor(() => expect(useAthenaStore.getState().pendingDecision).toBeNull());
  });

  it('keeps the bubble when the chip failed to load — a failed read proves nothing', async () => {
    roster.items = [approval];
    const hook = renderHook(() => useDecisionQueue({ ...roster }));
    await waitFor(() => expect(useAthenaStore.getState().pendingDecision?.id).toBe(approval.id));

    roster.items = [];
    roster.errors = { gates: 'database is locked' };
    hook.rerender();

    expect(useAthenaStore.getState().pendingDecision?.id).toBe(approval.id);
  });
});
