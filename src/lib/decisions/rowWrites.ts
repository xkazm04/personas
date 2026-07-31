/**
 * rowWrites — ONE write door per decidable row type.
 *
 * A "decidable row" is anything the product asks a human to rule on: a manual
 * review, a backlog idea, a workspace practice. Fifteen frontend call sites used
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
import { extractMessage } from '@/lib/silentCatch';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { KnowledgeDecision } from '@/api/devTools/workspaces';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

/**
 * The backend's phrase for a lost compare-and-swap, emitted by all three row
 * types: `manual_reviews::update_status`, `dev_tools::apply_idea_verdict_cas`
 * and `dev_workspaces::decide_knowledge_cas`.
 *
 * Matched on the message rather than an error code because `AppError::Validation`
 * is the only channel these repos have; the wording is asserted by the Rust
 * tests on both sides so it cannot drift silently.
 */
const CONFLICT_PATTERN = /already (?:decided|resolved)[\s\S]{0,80}?by a concurrent action/i;

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
  return CONFLICT_PATTERN.test(extractMessage(error));
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
