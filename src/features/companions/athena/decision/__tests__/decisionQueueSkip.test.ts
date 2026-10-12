/**
 * The queue honours the skip/snooze ledger. sweep #261.
 *
 * `buildQueue` is the ONE place that decides what the orb may show, so it is
 * the one place the ledger is consulted. Driven through the exported seam
 * (`buildDecisionQueueForTest`) rather than a re-implementation, so what is
 * asserted is the list the bubble really receives. The approvals arrive as the
 * Decision Center roster hands them over (its own adapter), since the orb now
 * reads them from the roster rather than fetching its own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { approvalToDecision } from '@/features/decision-center/roster/decisionAdapters';
import { DEFAULT_DECISION_COPY } from '@/features/decision-center/roster/decisionCopy';
import type { PendingApproval } from '@/api/companion';

import { buildDecisionQueueForTest } from '../useDecisionQueue';
import { resetDecisionDeferrals, skipDecision } from '../decisionDeferral';

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListProactiveMessages: vi.fn(async () => []),
  };
});
vi.mock('@/api/fleet/claudeAccounts', () => ({
  listClaudeAccounts: vi.fn(async () => ({ accounts: [] })),
  reloginClaudeAccount: vi.fn(),
}));

function approval(id: string, action: string, createdAt: string): PendingApproval {
  return { id, action, rationale: 'r', paramsJson: '{}', humanReviewId: null, createdAt };
}

const roster = {
  items: [
    approvalToDecision(approval('appr_1', 'write_fact', '2026-09-18T10:00:00Z'), 'low', DEFAULT_DECISION_COPY),
    approvalToDecision(approval('appr_2', 'write_goal', '2026-09-18T10:01:00Z'), 'high', DEFAULT_DECISION_COPY),
  ],
  decide: vi.fn(async () => undefined),
};

describe('buildQueue x the deferral ledger', () => {
  beforeEach(() => resetDecisionDeferrals());

  it('returns both approvals when nothing is deferred (instrument check)', async () => {
    const queue = await buildDecisionQueueForTest(roster);
    expect(queue.map((d) => d.id)).toEqual(['approval:appr_1', 'approval:appr_2']);
  });

  it('drops a skipped decision so the one behind it becomes queue[0]', async () => {
    skipDecision('approval:appr_1');
    const queue = await buildDecisionQueueForTest(roster);
    expect(queue.map((d) => d.id)).toEqual(['approval:appr_2']);
    // The row itself is untouched - the roster still holds it, the orb just
    // stops asking about it this session.
    expect(queue).toHaveLength(1);
  });

  it('empties the queue when everything is skipped, rather than re-surfacing one', async () => {
    skipDecision('approval:appr_1');
    skipDecision('approval:appr_2');
    expect(await buildDecisionQueueForTest(roster)).toEqual([]);
  });
});
