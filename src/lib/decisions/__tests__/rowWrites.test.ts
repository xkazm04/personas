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
const mockPolicyApply = vi.fn();
const mockPolicyDecline = vi.fn();
const mockResolvePromotion = vi.fn();
const mockResolveIncident = vi.fn();
const mockDismissIncident = vi.fn();
const mockAckIncident = vi.fn();
const mockStartIncident = vi.fn();
const mockMarkReportRead = vi.fn();
const mockApproveAction = vi.fn();
const mockRejectAction = vi.fn();

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
vi.mock('@/api/system/policyTuning', () => ({
  policyTuningApply: (...a: unknown[]) => mockPolicyApply(...a),
  policyTuningDecline: (...a: unknown[]) => mockPolicyDecline(...a),
}));
vi.mock('@/api/agents/evolution', () => ({
  resolvePromotionProposal: (...a: unknown[]) => mockResolvePromotion(...a),
}));

vi.mock('@/api/overview/incidents', () => ({
  resolveAuditIncident: (...a: unknown[]) => mockResolveIncident(...a),
  dismissAuditIncident: (...a: unknown[]) => mockDismissIncident(...a),
  acknowledgeAuditIncident: (...a: unknown[]) => mockAckIncident(...a),
  setIncidentInProgress: (...a: unknown[]) => mockStartIncident(...a),
}));
vi.mock('@/api/overview/reports', () => ({
  markReportRead: (...a: unknown[]) => mockMarkReportRead(...a),
}));
vi.mock('@/api/companion', () => ({
  companionApproveAction: (...a: unknown[]) => mockApproveAction(...a),
  companionRejectAction: (...a: unknown[]) => mockRejectAction(...a),
}));

import {
  ApprovalActionFailedError,
  decideCompanionApprovalRow,
  markReportReadRow,
  resolveIncidentRow,
  decideEvolutionProposalRow,
  decideIdeaRow,
  decidePolicyProposalRow,
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

describe('the idea door carries the status the caller SAW', () => {
  it('sends seenStatus as the compare-and-swap expectation', async () => {
    await decideIdeaRow('idea-1', 'accept', { seenStatus: 'pending' });
    expect(mockAcceptIdea).toHaveBeenCalledWith('idea-1', 'pending');

    await decideIdeaRow('idea-1', 'reject', { seenStatus: 'pending', reason: 'Out of scope' });
    expect(mockRejectIdea).toHaveBeenCalledWith('idea-1', 'Out of scope', 'pending');
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

/** The value a promise rejected with; fails the test if it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

describe('incident door — a `false` is a verdict somebody else landed, not success', () => {
  it('routes each act to its command, trimming the note', async () => {
    mockResolveIncident.mockResolvedValue(true);
    mockDismissIncident.mockResolvedValue(true);
    mockAckIncident.mockResolvedValue(true);
    mockStartIncident.mockResolvedValue(true);

    await resolveIncidentRow('inc-1', 'resolve', '  fixed the key  ');
    expect(mockResolveIncident).toHaveBeenCalledWith('inc-1', 'fixed the key');
    await resolveIncidentRow('inc-1', 'dismiss', '   ');
    expect(mockDismissIncident).toHaveBeenCalledWith('inc-1', undefined);
    await resolveIncidentRow('inc-1', 'acknowledge');
    expect(mockAckIncident).toHaveBeenCalledWith('inc-1');
    await resolveIncidentRow('inc-1', 'start');
    expect(mockStartIncident).toHaveBeenCalledWith('inc-1');
  });

  it('REJECTS when the command answers false, and the rejection reads as a conflict', async () => {
    // `apply_transition` returns Ok(false) when the row is ALREADY in the
    // target state: someone resolved it first. Resolving here would report a
    // verdict this person never landed.
    mockResolveIncident.mockResolvedValueOnce(false);
    const err = await rejectionOf(resolveIncidentRow('inc-2', 'resolve'));
    expect(err).toBeInstanceOf(Error);
    expect(isDecisionConflict(err)).toBe(true);

    mockStartIncident.mockResolvedValueOnce(false);
    await expect(resolveIncidentRow('inc-2', 'start')).rejects.toThrow(/in_progress/);
  });

  it('REJECTS on a failed write, as an ordinary failure', async () => {
    mockDismissIncident.mockRejectedValueOnce(new Error('Invalid status transition: resolved → dismissed'));
    const err = await rejectionOf(resolveIncidentRow('inc-3', 'dismiss'));
    expect(isDecisionConflict(err)).toBe(false);
  });
});

describe('report door', () => {
  it('marks read, and rejects when the write fails', async () => {
    mockMarkReportRead.mockResolvedValueOnce(undefined);
    await markReportReadRow('rep-1');
    expect(mockMarkReportRead).toHaveBeenCalledWith('rep-1');

    mockMarkReportRead.mockRejectedValueOnce(new Error('PersonaReport rep-2 not found'));
    await expect(markReportReadRow('rep-2')).rejects.toThrow('not found');
  });
});

describe('companion approval door', () => {
  it('approves and rejects through the companion commands', async () => {
    mockApproveAction.mockResolvedValueOnce({ id: 'ap-1', status: 'approved', message: 'ok' });
    await expect(decideCompanionApprovalRow('ap-1', true)).resolves.toMatchObject({ status: 'approved' });

    mockRejectAction.mockResolvedValueOnce({ id: 'ap-1', status: 'rejected', message: '' });
    await decideCompanionApprovalRow('ap-1', false, '  not now  ');
    expect(mockRejectAction).toHaveBeenCalledWith('ap-1', 'not now');
  });

  it('rejects with ApprovalActionFailedError when the approved action failed', async () => {
    mockApproveAction.mockResolvedValueOnce({
      id: 'ap-2',
      status: 'approved_failed',
      message: 'Execution failed: no such persona',
    });
    const err = await rejectionOf(decideCompanionApprovalRow('ap-2', true));
    expect(err).toBeInstanceOf(ApprovalActionFailedError);
    expect((err as ApprovalActionFailedError).outcome.status).toBe('approved_failed');
  });

  it('recognises the lost claim as a conflict', () => {
    // `approval_lifecycle::load_pending`, verbatim.
    expect(
      isDecisionConflict(new Error('approval `ap-3` is `approved`, not pending')),
    ).toBe(true);
  });
});
