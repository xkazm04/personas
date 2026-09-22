/**
 * The queue honours the skip/snooze ledger. sweep #261.
 *
 * `buildQueue` is the ONE place that decides what the orb may show, so it is
 * the one place the ledger is consulted. Driven through the exported seam
 * (`buildDecisionQueueForTest`) rather than a re-implementation, so what is
 * asserted is the list the bubble really receives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildDecisionQueueForTest } from '../useDecisionQueue';
import { resetDecisionDeferrals, skipDecision } from '../decisionDeferral';

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListPendingApprovals: vi.fn(async () => [
      {
        id: 'appr_1',
        action: 'write_fact',
        rationale: 'Remember the release date',
        paramsJson: '{}',
        humanReviewId: null,
        createdAt: '2026-09-18T10:00:00Z',
      },
      {
        id: 'appr_2',
        action: 'write_goal',
        rationale: 'Ship the sweep',
        paramsJson: '{}',
        humanReviewId: null,
        createdAt: '2026-09-18T10:01:00Z',
      },
    ]),
    companionListProactiveMessages: vi.fn(async () => []),
  };
});

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: vi.fn(async () => []),
  listManualReviewsPage: vi.fn(async () => ({ rows: [], nextCursor: null, hasMore: false })),
}));

describe('buildQueue x the deferral ledger', () => {
  beforeEach(() => resetDecisionDeferrals());

  it('returns both approvals when nothing is deferred (instrument check)', async () => {
    const queue = await buildDecisionQueueForTest();
    expect(queue.map((d) => d.id)).toEqual(['approval:appr_1', 'approval:appr_2']);
  });

  it('drops a skipped decision so the one behind it becomes queue[0]', async () => {
    skipDecision('approval:appr_1');
    const queue = await buildDecisionQueueForTest();
    expect(queue.map((d) => d.id)).toEqual(['approval:appr_2']);
    // The row itself is untouched - the API still returns it, the orb just
    // stops asking about it this session.
    expect(queue).toHaveLength(1);
  });

  it('empties the queue when everything is skipped, rather than re-surfacing one', async () => {
    skipDecision('approval:appr_1');
    skipDecision('approval:appr_2');
    expect(await buildDecisionQueueForTest()).toEqual([]);
  });
});
