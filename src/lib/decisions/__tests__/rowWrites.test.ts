/**
 * The one write door per decidable row type.
 *
 * Two properties are pinned here, and both are cross-layer contracts that no
 * single file can enforce on its own:
 *
 *  1. **Local vs cloud is decided in ONE place.** Six surfaces used to re-derive
 *     it; two got it wrong. The door owns the branch, so a review row's `source`
 *     is the only thing that decides which backend hears about the verdict.
 *  2. **The conflict phrase is a contract with Rust.** `isDecisionConflict` is
 *     what tells "your write failed, retry" apart from "someone else already
 *     decided this, reload" — and every optimistic surface behaves differently
 *     between those two. It matches the wording emitted by
 *     `manual_reviews::update_status`, `dev_tools::apply_idea_verdict_cas` and
 *     `dev_workspaces::decide_knowledge_cas`; the strings below are copied from
 *     those three `format!`s, so a reworded backend message fails HERE rather
 *     than degrading silently into a generic "could not record that decision".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateStatus = vi.fn();
const mockDispatchAction = vi.fn();
const mockCloudRespond = vi.fn();
const mockAcceptIdea = vi.fn();
const mockRejectIdea = vi.fn();
const mockDecideKnowledge = vi.fn();
const mockPolicyApply = vi.fn();
const mockPolicyDecline = vi.fn();
const mockResolvePromotion = vi.fn();

vi.mock('@/api/overview/reviews', () => ({
  updateManualReviewStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  dispatchReviewAction: (...a: unknown[]) => mockDispatchAction(...a),
}));
vi.mock('@/api/system/cloud', () => ({
  cloudRespondToReview: (...a: unknown[]) => mockCloudRespond(...a),
}));
vi.mock('@/api/devTools/devTools', () => ({
  acceptIdea: (...a: unknown[]) => mockAcceptIdea(...a),
  rejectIdea: (...a: unknown[]) => mockRejectIdea(...a),
}));
vi.mock('@/api/devTools/workspaces', () => ({
  decideWorkspaceKnowledge: (...a: unknown[]) => mockDecideKnowledge(...a),
}));
vi.mock('@/api/system/policyTuning', () => ({
  policyTuningApply: (...a: unknown[]) => mockPolicyApply(...a),
  policyTuningDecline: (...a: unknown[]) => mockPolicyDecline(...a),
}));
vi.mock('@/api/agents/evolution', () => ({
  resolvePromotionProposal: (...a: unknown[]) => mockResolvePromotion(...a),
}));

import {
  decideEvolutionProposalRow,
  decideIdeaRow,
  decidePolicyProposalRow,
  decidePracticeRow,
  dispatchReviewRowAction,
  isDecisionConflict,
  resolveReviewRow,
} from '../rowWrites';

const local = { id: 'rev-1', execution_id: 'exec-1', source: 'local' as const };
const cloud = { id: 'rev-2', execution_id: 'exec-2', source: 'cloud' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateStatus.mockResolvedValue(undefined);
  mockDispatchAction.mockResolvedValue(undefined);
  mockCloudRespond.mockResolvedValue(undefined);
  mockPolicyApply.mockResolvedValue(undefined);
  mockPolicyDecline.mockResolvedValue(undefined);
  mockResolvePromotion.mockResolvedValue(undefined);
});

describe('resolveReviewRow — local vs cloud in one place', () => {
  it('writes a local verdict through the manual-review command', async () => {
    await resolveReviewRow(local, 'approved', 'looks right');
    expect(mockUpdateStatus).toHaveBeenCalledWith('rev-1', 'approved', 'looks right');
    expect(mockCloudRespond).not.toHaveBeenCalled();
  });

  it('routes a cloud row to the cloud worker, mapping the verdict', async () => {
    await resolveReviewRow(cloud, 'rejected');
    expect(mockCloudRespond).toHaveBeenCalledWith('exec-2', 'rev-2', 'reject', '');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('treats a row with no source as local', async () => {
    await resolveReviewRow({ id: 'rev-3', execution_id: 'e3' }, 'approved');
    expect(mockUpdateStatus).toHaveBeenCalledWith('rev-3', 'approved', undefined);
  });

  it('REJECTS when the cloud write fails', async () => {
    // The hole this closed: the cloud path used to go through
    // `overviewSlice.respondToCloudReview`, whose catch calls `reportError` —
    // which returns a string and never throws. A failed cloud verdict therefore
    // resolved, and every optimistic caller reported a decision that never landed.
    mockCloudRespond.mockRejectedValueOnce(new Error('cloud worker unreachable'));
    await expect(resolveReviewRow(cloud, 'approved')).rejects.toThrow('cloud worker unreachable');
  });

  it('dispatches a chosen action locally, and records it as an approval in the cloud', async () => {
    await dispatchReviewRowAction(local, 'rotate the key');
    expect(mockDispatchAction).toHaveBeenCalledWith('rev-1', 'rotate the key');

    await dispatchReviewRowAction(cloud, 'rotate the key');
    // Cloud rows have no dispatch path — the choice rides as the message.
    expect(mockCloudRespond).toHaveBeenCalledWith('exec-2', 'rev-2', 'approve', 'rotate the key');
  });
});

describe('idea + practice doors carry the status the caller SAW', () => {
  it('sends seenStatus as the compare-and-swap expectation', async () => {
    await decideIdeaRow('idea-1', 'accept', { seenStatus: 'pending' });
    expect(mockAcceptIdea).toHaveBeenCalledWith('idea-1', 'pending');

    await decideIdeaRow('idea-1', 'reject', { seenStatus: 'pending', reason: 'Out of scope' });
    expect(mockRejectIdea).toHaveBeenCalledWith('idea-1', 'Out of scope', 'pending');

    await decidePracticeRow('k-1', 'deprecate', { seenStatus: 'adopted', supersededBy: 'k-2' });
    expect(mockDecideKnowledge).toHaveBeenCalledWith('k-1', 'deprecate', 'k-2', 'adopted');
  });

  it('omits it for callers with no rendered row', async () => {
    await decideIdeaRow('idea-1', 'accept');
    expect(mockAcceptIdea).toHaveBeenCalledWith('idea-1', undefined);
  });
});

describe('proposal doors — an expectation the backend does not take a parameter for', () => {
  it('applies and declines a policy proposal through the ONE policy writer', async () => {
    await decidePolicyProposalRow('pol-1', 'apply', { seenStatus: 'pending' });
    expect(mockPolicyApply).toHaveBeenCalledWith('pol-1');

    await decidePolicyProposalRow('pol-1', 'decline', {
      seenStatus: 'pending',
      reason: 'Quality risk',
    });
    expect(mockPolicyDecline).toHaveBeenCalledWith('pol-1', 'Quality risk');
  });

  it('sends no reason at all rather than an empty one', async () => {
    await decidePolicyProposalRow('pol-1', 'decline', { reason: '' });
    expect(mockPolicyDecline).toHaveBeenCalledWith('pol-1', undefined);
  });

  it('approves and rejects a promotion, forwarding the decision note', async () => {
    await decideEvolutionProposalRow('prop-1', 'approve', { seenStatus: 'pending' });
    expect(mockResolvePromotion).toHaveBeenCalledWith('prop-1', true, undefined);

    await decideEvolutionProposalRow('prop-1', 'reject', { reason: 'Gain too small' });
    expect(mockResolvePromotion).toHaveBeenLastCalledWith('prop-1', false, 'Gain too small');
  });

  it('refuses BEFORE the IPC when the card already knows the row is spent', async () => {
    // Neither command takes an expectation — their write is unconditionally
    // `WHERE status = 'pending'`. The door still fails fast on a visibly stale
    // card, and does it with wording `isDecisionConflict` recognises, so a
    // locally-detected conflict is indistinguishable from a backend one.
    let policyError: unknown;
    try {
      await decidePolicyProposalRow('pol-1', 'apply', { seenStatus: 'applied' });
    } catch (error) {
      policyError = error;
    }
    expect(isDecisionConflict(policyError)).toBe(true);
    expect(mockPolicyApply).not.toHaveBeenCalled();

    let promotionError: unknown;
    try {
      await decideEvolutionProposalRow('prop-1', 'approve', { seenStatus: 'approved' });
    } catch (error) {
      promotionError = error;
    }
    expect(isDecisionConflict(promotionError)).toBe(true);
    expect(mockResolvePromotion).not.toHaveBeenCalled();
  });

  it('does not guess an expectation the caller never made', async () => {
    await decidePolicyProposalRow('pol-1', 'apply');
    expect(mockPolicyApply).toHaveBeenCalledWith('pol-1');
  });
});

describe('isDecisionConflict — the wording contract with Rust', () => {
  it('recognises the message every row type emits on a lost swap', () => {
    // Copied verbatim from the three backend `format!`s.
    expect(
      isDecisionConflict(
        new Error('Manual review abc was already resolved by a concurrent action'),
      ),
    ).toBe(true);
    expect(
      isDecisionConflict(
        new Error("Backlog idea abc was already decided as 'rejected' by a concurrent action"),
      ),
    ).toBe(true);
    expect(
      isDecisionConflict(
        new Error("Practice abc was already decided as 'adopted' by a concurrent action"),
      ),
    ).toBe(true);
  });

  it('recognises the two PROPOSAL ledgers, which word it entirely differently', () => {
    // `commands::execution::policy_tuning`.
    expect(isDecisionConflict(new Error('proposal pol-1 was decided concurrently'))).toBe(true);
    expect(isDecisionConflict(new Error("proposal pol-1 is 'declined', not pending"))).toBe(true);
    expect(isDecisionConflict(new Error('proposal pol-1 is not pending'))).toBe(true);
    // `repos::lab::evolution_proposals`.
    expect(isDecisionConflict(new Error('Proposal prop-1 is already approved'))).toBe(true);
    expect(
      isDecisionConflict(new Error('Proposal prop-1 is not pending (missing or already decided)')),
    ).toBe(true);
  });

  it('recognises the PERSONA optimistic lock, which loses on a different table', () => {
    // `engine::evolution::apply_promotion` swaps on the persona's `updated_at`,
    // not on the proposal's status. Different row, same reviewer-facing
    // meaning: this can no longer land, so do not put the card back.
    expect(
      isDecisionConflict(
        new Error(
          'Persona changed after this proposal was filed — promotion abandoned to avoid overwriting the newer state. Reject the proposal and run a fresh cycle.',
        ),
      ),
    ).toBe(true);
  });

  it('reads through the Tauri error envelopes, not just Error instances', () => {
    expect(
      isDecisionConflict({ message: 'Practice k was already decided as \'adopted\' by a concurrent action' }),
    ).toBe(true);
    expect(
      isDecisionConflict('Manual review r was already resolved by a concurrent action'),
    ).toBe(true);
  });

  it('does NOT claim an ordinary failure', () => {
    // These must restore the card, not leave it resolved.
    expect(isDecisionConflict(new Error('database is locked'))).toBe(false);
    expect(isDecisionConflict(new Error('Validation: title cannot be empty'))).toBe(false);
    expect(isDecisionConflict(null)).toBe(false);
  });
});
