/**
 * rowWrites — ONE write door per decidable row type.
 *
 * A "decidable row" is anything the product asks a human to rule on: a manual
 * review, a backlog idea, a workspace practice, a policy proposal, an evolution
 * promotion proposal. Fifteen frontend call sites used
 * to write those verdicts, each with its own error handling — four swallowed the
 * failure outright, one discarded every failure in a `Promise.allSettled`, and
 * one wrote reviews through a Zustand action whose `catch` returns a string
 * instead of rejecting. The result was uniform: a row that leaves the list, a
 * counter that ticks, and SQLite still saying `pending`.
 *
 * Two rules this module exists to make true everywhere at once:
 *
 * 1. **Every door REJECTS on a failed write.** No door resolves on failure, ever.
 *    Optimistic UI is fine — it is only honest if the rejection can undo it.
 * 2. **Every door carries the status the caller SAW.** The backend turns that
 *    into a compare-and-swap, so a verdict written from a card someone else
 *    already decided loses loudly instead of overwriting them. Ask
 *    {@link isDecisionConflict} about a rejection to tell "your write failed,
 *    retry" apart from "someone else already decided this, reload".
 *
 * Since the moonshot campaign shipped Night Shift, Athena resolves approvals
 * unattended overnight — every swallowing call site became a nightly silent-loss
 * vector and the compare-and-swap loser became a routine event rather than a
 * race. That is why this is a shared module and not a note in a review.
 *
 * Deliberately store-free and React-free: it imports only `@/api/*`, so any
 * surface (hook, Zustand slice, component) can route through it without an
 * import cycle, and every branch is a plain function call in a test.
 */
import {
  updateManualReviewStatus,
  dispatchReviewAction as dispatchReviewActionApi,
} from '@/api/overview/reviews';
import { cloudRespondToReview } from '@/api/system/cloud';
import { acceptIdea as acceptIdeaApi, rejectIdea as rejectIdeaApi } from '@/api/devTools/devTools';
import { decideWorkspaceKnowledge } from '@/api/devTools/workspaces';
import { policyTuningApply, policyTuningDecline } from '@/api/system/policyTuning';
import { resolvePromotionProposal } from '@/api/agents/evolution';
import { extractMessage } from '@/lib/silentCatch';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { KnowledgeDecision } from '@/api/devTools/workspaces';
import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

/**
 * Every phrase the backend uses for "you lost the swap", across five row types.
 *
 * Matched on the message rather than an error code because `AppError::Validation`
 * is the only channel these repos have. Each entry is copied from a Rust
 * `format!`; `__tests__/rowWrites.test.ts` pins them all verbatim, so a reworded
 * backend message fails there rather than degrading silently into a generic
 * "could not record that decision".
 *
 * 1. **The original three** — `manual_reviews::update_status`,
 *    `dev_tools::apply_idea_verdict_cas`, `dev_workspaces::decide_knowledge_cas`.
 *    The gap in the middle is load-bearing, not laziness: reviews say "already
 *    RESOLVED by a concurrent action" while ideas and practices interpose the
 *    status that won — "already DECIDED AS 'rejected' by a concurrent action". A
 *    pattern requiring the two halves to be adjacent matches reviews and silently
 *    misses the other two.
 * 2. **Policy proposals** — `policy_tuning_apply` loses the ledger's
 *    `mark_applied` swap ("was decided concurrently") or trips its own
 *    not-pending precheck.
 * 3. **Promotion proposals** — the ledger's terminal-status guard ("is already
 *    approved" / "is not pending"), AND the persona optimistic lock, which is
 *    the one conflict in this file that is NOT about the decided row itself:
 *    `engine::evolution::apply_promotion` swaps on the persona's `updated_at`,
 *    so a persona edited since the cycle ran fails the promotion closed. Same
 *    reviewer-facing meaning — "this can no longer land, reload" — so it belongs
 *    in the same bucket even though the losing row is a different table.
 */
const CONFLICT_PATTERNS: readonly RegExp[] = [
  /already (?:decided|resolved)[\s\S]{0,80}?by a concurrent action/i,
  /\bwas decided concurrently\b/i,
  /\bproposal \S+ is (?:already \w+|not pending)/i,
  /\bproposal \S+ is '[^']*', not pending/i,
  /\bchanged after this proposal was filed\b/i,
];

/**
 * True when a rejected write LOST to somebody else's verdict rather than
 * failing.
 *
 * The distinction is the whole user-facing point. A failed write means "that
 * didn't land — try again" and the row must come back. A conflict means "this
 * row IS decided, just not by you" — putting it back would be a lie, so the
 * honest response is to say so and reload the surface.
 */
export function isDecisionConflict(error: unknown): boolean {
  const message = extractMessage(error);
  return CONFLICT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * The status a proposal row must still be in for a verdict to land, and the
 * error a door raises when the CARD already knows it is not.
 *
 * Both proposal commands write `WHERE status = 'pending'` unconditionally —
 * their expectation is fixed, not a parameter — so there is nothing to send.
 * The doors still take `seenStatus`, for two reasons: the contract shape stays
 * identical across all five row types (a caller does not have to remember which
 * backends accept an expectation), and a card that is visibly stale fails
 * before the IPC rather than after it, exactly as `decide_knowledge_cas` fails
 * fast before opening its transaction.
 *
 * The message is worded to match {@link CONFLICT_PATTERNS} so a locally-detected
 * conflict is indistinguishable, to every caller, from one the backend raised.
 */
const PROPOSAL_PENDING = 'pending';

function assertProposalPending(id: string, seenStatus: string | undefined): void {
  if (seenStatus && seenStatus !== PROPOSAL_PENDING) {
    throw new Error(`Proposal ${id} is already ${seenStatus}`);
  }
}

// ---------------------------------------------------------------------------
// Manual reviews
// ---------------------------------------------------------------------------

/** The columns a review verdict needs. Structurally satisfied by
 *  `ManualReviewItem`, `MonitorReviewItem` and `PersonaManualReview` alike. */
export interface ReviewRowRef {
  id: string;
  execution_id: string;
  /** `'cloud'` rows resolve through the cloud worker; anything else is local. */
  source?: 'local' | 'cloud' | null;
}

/**
 * Resolve a manual review — the ONE door for approve/reject on a review row.
 *
 * Routes local vs cloud itself, because "which backend owns this row" is
 * precisely the branch six surfaces each re-derived and two got wrong. Rejects
 * on failure: the cloud path used to go through `overviewSlice.respondToCloudReview`,
 * whose `catch` calls `reportError` (which RETURNS a string and never throws),
 * so a failed cloud verdict resolved successfully and the card left the deck.
 */
export async function resolveReviewRow(
  row: ReviewRowRef,
  status: ManualReviewStatus,
  notes?: string,
): Promise<void> {
  if (row.source === 'cloud') {
    await cloudRespondToReview(
      row.execution_id,
      row.id,
      status === 'approved' ? 'approve' : 'reject',
      notes ?? '',
    );
    return;
  }
  await updateManualReviewStatus(row.id, status, notes);
}

/**
 * Resolve a review by CHOOSING one of its suggested actions — records the branch
 * AND dispatches a follow-up persona run to carry it out.
 *
 * Cloud rows have no dispatch path, so the choice is recorded as an approval
 * carrying the action as its message. Same door, same rejection contract.
 */
export async function dispatchReviewRowAction(row: ReviewRowRef, action: string): Promise<void> {
  if (row.source === 'cloud') {
    await cloudRespondToReview(row.execution_id, row.id, 'approve', action);
    return;
  }
  await dispatchReviewActionApi(row.id, action);
}

// ---------------------------------------------------------------------------
// Backlog ideas
// ---------------------------------------------------------------------------

export interface IdeaVerdictOptions {
  /**
   * The status the calling surface RENDERED on this row (`'pending'` for
   * anything dealing from a pending queue). Omit only where no row was shown.
   */
  seenStatus?: string;
  /** Rejection reason. The backend turns it into a `constraint` memory that
   *  suppresses the idea in every future scan — which is exactly why a rejection
   *  written against a stale row must not land. */
  reason?: string;
}

/**
 * Decide a backlog idea — the ONE door for accept/reject on an idea row.
 *
 * Rejecting writes a permanent "never raise this again" constraint; accepting
 * writes a `decision` memory and syncs workspace adoption. Both fan out, so both
 * must be single-winner — hence `seenStatus`.
 */
export function decideIdeaRow(
  id: string,
  verdict: 'accept' | 'reject',
  options: IdeaVerdictOptions = {},
): Promise<DevIdea> {
  const { seenStatus, reason } = options;
  return verdict === 'accept'
    ? acceptIdeaApi(id, seenStatus)
    : rejectIdeaApi(id, reason, seenStatus);
}

// ---------------------------------------------------------------------------
// Workspace practices
// ---------------------------------------------------------------------------

export interface PracticeVerdictOptions {
  /** The status the calling surface RENDERED (`'observed'` / `'proposed'` for a
   *  pending review queue). */
  seenStatus?: string;
  /** Id of the practice that REPLACES this one. Valid only with `deprecate` —
   *  the backend rejects it outright on any other decision. */
  supersededBy?: string;
}

/**
 * Decide a workspace practice — the ONE door for adopt/reject/deprecate.
 *
 * `adopt` fans an adoption cell into every applicable member repo, so a stale
 * adopt is not a status typo but work queued across a whole workspace. The
 * compare-and-swap rolls the whole transaction back rather than seeding cells
 * for a decision that lost.
 */
export function decidePracticeRow(
  id: string,
  decision: KnowledgeDecision,
  options: PracticeVerdictOptions = {},
): Promise<WorkspaceKnowledge> {
  return decideWorkspaceKnowledge(id, decision, options.supersededBy, options.seenStatus);
}

// ---------------------------------------------------------------------------
// Policy proposals (Self-Tuning Fabric)
// ---------------------------------------------------------------------------

export interface ProposalVerdictOptions {
  /** The status the calling surface RENDERED (`'pending'` for a review queue). */
  seenStatus?: string;
  /** Why it was declined. Stored on the row and read back in the history list. */
  reason?: string;
}

/**
 * Decide a policy proposal — the ONE door for apply/decline.
 *
 * `policyTuningApply` is, by the Self-Tuning Fabric's own contract, the ONLY
 * writer of a routing rule or a budget ceiling: the generator only ever inserts
 * proposals. So this door does not "write a policy" — it hands the proposal to
 * the single applier and lets it do that. Nothing here may grow a second path.
 */
export async function decidePolicyProposalRow(
  id: string,
  verdict: 'apply' | 'decline',
  options: ProposalVerdictOptions = {},
): Promise<PolicyProposal> {
  // `async` so the precheck REJECTS rather than throwing synchronously: every
  // caller of these doors is an optimistic surface whose restore path lives in
  // a `.catch`, and a door that sometimes throws before returning a promise is
  // a door whose failure sometimes escapes it.
  assertProposalPending(id, options.seenStatus);
  return verdict === 'apply'
    ? policyTuningApply(id)
    : policyTuningDecline(id, options.reason || undefined);
}

// ---------------------------------------------------------------------------
// Evolution promotion proposals (Darwin Mode)
// ---------------------------------------------------------------------------

export interface PromotionVerdictOptions extends ProposalVerdictOptions {
  /**
   * The incumbent persona's `updated_at` as the cycle captured it — the row's
   * SECOND lock, and the only optimistic-lock token any decidable row in this
   * app carries.
   *
   * It is deliberately not sent. `evolution_resolve_promotion_proposal` reads it
   * off the stored proposal and hands it to `apply_promotion`, so the token is
   * server-held and cannot be spoofed or staled by the client. Callers pass it
   * only so the DECK can show what the promotion is pinned to; a reviewer whose
   * card says "filed against persona state from Tuesday" understands the
   * fail-closed before it happens rather than after.
   */
  baseUpdatedAt?: string;
}

/**
 * Decide an evolution promotion proposal — the ONE door for approve/reject.
 *
 * Approval is the largest blast radius of any verdict this app collects: it
 * installs the winning genome's reassembled system prompt onto a LIVE persona
 * and writes field-level `persona_change_log` rows. Two locks stand between the
 * card and that write, and they do not unify:
 *
 *  • the proposal's own `status` — the `expectedStatus` contract every other row
 *    type speaks, enforced by `evolution_proposals::resolve`'s
 *    `WHERE status = 'pending'`;
 *  • the persona's `updated_at` — see {@link PromotionVerdictOptions.baseUpdatedAt}.
 *
 * They fail with different messages against different tables, and both are
 * conflicts to the reviewer, which is why {@link isDecisionConflict} recognises
 * both rather than the deck learning the difference.
 */
export async function decideEvolutionProposalRow(
  id: string,
  verdict: 'approve' | 'reject',
  options: PromotionVerdictOptions = {},
): Promise<EvolutionPromotionProposal> {
  assertProposalPending(id, options.seenStatus);
  return resolvePromotionProposal(id, verdict === 'approve', options.reason || undefined);
}
