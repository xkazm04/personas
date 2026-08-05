/**
 * triageDispatch.ts — one verdict in, one backend write out.
 *
 * Split out of `useUnifiedTriage` for one reason: routing a verdict is the part
 * that can silently do nothing, and a `switch` buried inside a hook that needs
 * four stores mounted is a `switch` nobody tests. Everything here takes its
 * writes as injected {@link TriagePorts}, so every branch — including the ones
 * that used to fall through — is a plain function call in a test.
 *
 * The contract this file exists to enforce:
 *
 *   **Every decision either DEFERS, or WRITES, or THROWS. Never nothing.**
 *
 * The queue removes an item optimistically the moment it decides, so a branch
 * that matches no case is indistinguishable from a successful write to the
 * reviewer while the backend still says `pending`. Two paths used to do exactly
 * that: rejecting a build question (no branch matched) and accepting one with
 * an empty answer.
 *
 * React-free and store-free on purpose.
 */
import type { TriageDecision } from './triageTypes';

/** Drop blank fields and trim the rest — what actually gets written. */
export function filledAnswers(answers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers ?? {})) {
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/** Every write the queue can perform, injected. */
export interface TriagePorts {
  reviewAction: (id: string, status: 'approved' | 'rejected', notes?: string) => Promise<void>;
  dispatchReviewAction: (id: string, action: string) => Promise<void>;
  createTask: (
    title: string,
    projectId: string | undefined,
    body: string,
    ideaId: string,
  ) => Promise<unknown>;
  /**
   * `seenStatus` is the status the CARD rendered. Every write door in this app
   * carries it so the backend can make the write a single-winner
   * compare-and-swap — a verdict decided on a card someone else already ruled on
   * must lose loudly, not overwrite them. It is threaded through the ports (not
   * read from the item inside the port) so this router stays the one place that
   * knows where a verdict's facts come from.
   */
  acceptIdea: (id: string, seenStatus?: string) => Promise<unknown>;
  rejectIdea: (id: string, reason?: string, seenStatus?: string) => Promise<unknown>;
  /**
   * `supersededBy` is the id of the practice that REPLACES this one. The backend
   * rejects it outright for any decision other than `deprecate`, so the router
   * only ever passes it on that branch.
   */
  decideKnowledge: (
    id: string,
    verdict: 'adopt' | 'reject' | 'deprecate',
    supersededBy?: string,
    seenStatus?: string,
  ) => Promise<unknown>;
  /** Fired after a practice verdict so the workspace centre re-reads. */
  refreshKnowledge: () => void;
  submitAnswers: (sessionId: string, answers: Record<string, string>) => Promise<void>;
  /**
   * Apply or decline a Self-Tuning Fabric proposal.
   *
   * Split into two ports rather than one `(id, verdict)` because they are not
   * symmetric: applying is the ONLY policy write in the app and takes nothing
   * but the id, while declining takes the reason that the settings history
   * later renders. A single port would have carried a `reason` that is
   * meaningless on one of its two branches.
   */
  applyPolicy: (id: string, seenStatus?: string) => Promise<unknown>;
  declinePolicy: (id: string, reason?: string, seenStatus?: string) => Promise<unknown>;
  /** Approve (install the winner genome) or reject a promotion proposal.
   *  `note` is the reviewer's recorded reason on a rejection. */
  decideEvolution: (
    id: string,
    approve: boolean,
    note?: string,
    seenStatus?: string,
  ) => Promise<unknown>;
  /** Fired after a proposal verdict so the two proposal queues re-read. */
  refreshProposals: () => void;
  /**
   * Sign a completed goal off, or send it back to the team with a comment.
   *
   * No `seenStatus` on either, and that asymmetry is deliberate rather than an
   * omission: `resolveGoalAcceptance(goalId, decision, comment)` takes no
   * seen-status, so goals are the one decidable row in the app with no
   * compare-and-swap. A token threaded here would be a token nothing reads.
   *
   * `comment` is required rather than optional because the command's parameter
   * is — the router passes an empty string when the reviewer skipped the reason
   * rather than pretending the argument is absent.
   */
  acceptGoal: (id: string) => Promise<void>;
  rejectGoal: (id: string, comment: string) => Promise<void>;
  /**
   * Put a decided row BACK — the undo half of the two kinds that have a reverse
   * door. `seenStatus` is the status the verdict produced, so the reopen is a
   * compare-and-swap exactly like the verdict was. See
   * `lib/decisions/rowWrites#ReopenOptions` for which rows reopen and what a
   * reopen does NOT retract.
   */
  reopenIdea: (id: string, seenStatus: string) => Promise<unknown>;
  reopenPractice: (id: string, seenStatus: string) => Promise<unknown>;
  /** Deep-link to the persona builder. Absent when the host has no route. */
  openBuilder?: (personaId: string) => void;
  /** Deep-link to a project's goals board. Absent when the host has no route. */
  openGoalBoard?: (projectId: string) => void;
}

/**
 * True when this verdict is a LOCAL deferral — nothing is written and the item
 * must STAY in the queue.
 *
 * Two cases, and the second is the interesting one:
 *
 *  • `skip` — the spine's "not now".
 *  • **`reject` on a build question.** There is no such thing as rejecting a
 *    question: the CLI is halted waiting for an answer and the only writes the
 *    backend offers are "here is the answer" and "cancel the whole session".
 *    The old code let reject fall through every branch — no write, but the card
 *    still left the queue and the persona stayed `awaiting_input` forever. A
 *    reject is therefore read as what it actually means from the reviewer's
 *    hand: *not me, not now*. Same as skip, and the card's own verdict labels
 *    already say "Skip" / "Later" rather than "Reject".
 *  • Accepting a question card with nothing filled in is likewise a no-op, not
 *    a resolution — the guard exists because an empty write is silent data loss.
 */
export function isDeferral(decision: TriageDecision): boolean {
  const { item, verdict, branchId, answers } = decision;
  if (verdict === 'skip') return true;
  if (item.kind !== 'question' || branchId) return false;
  if (verdict === 'reject') return true;
  return (
    Object.keys(filledAnswers(answers)).length === 0 || !item.payload?.sessionId
  );
}

/**
 * Perform the write behind a decision. Callers MUST have already excluded
 * deferrals via {@link isDeferral}.
 *
 * Throws when the decision cannot be honoured. That is deliberate: the queue's
 * restore-and-toast path is the only thing standing between a failed write and
 * a card that looks decided.
 */
export async function routeDecision(
  decision: TriageDecision,
  ports: TriagePorts,
): Promise<void> {
  const { item, verdict, branchId, answers, reason } = decision;

  switch (item.kind) {
    case 'review':
      if (branchId) await ports.dispatchReviewAction(item.sourceId, branchId);
      else if (verdict === 'accept') await ports.reviewAction(item.sourceId, 'approved');
      else await ports.reviewAction(item.sourceId, 'rejected', reason);
      return;

    case 'idea': {
      const seen = item.payload?.seenStatus ?? undefined;
      if (branchId === 'build') {
        // Task first, then the verdict: a failed task creation must not leave an
        // accepted idea with no work behind it. The residual case the swap makes
        // visible is the mirror — someone else decides the idea between these two
        // calls and the task outlives a verdict that never landed. Rare, and the
        // cheaper failure: an orphan task is a row a human can see and delete,
        // whereas an accepted idea with no task is invisible work that never
        // happens.
        await ports.createTask(
          item.title,
          item.payload?.projectId ?? undefined,
          item.body,
          item.sourceId,
        );
        await ports.acceptIdea(item.sourceId, seen);
      } else if (verdict === 'accept') {
        await ports.acceptIdea(item.sourceId, seen);
      } else {
        await ports.rejectIdea(item.sourceId, reason, seen);
      }
      return;
    }

    case 'practice': {
      const deprecating = branchId === 'deprecate';
      await ports.decideKnowledge(
        item.sourceId,
        deprecating ? 'deprecate' : verdict === 'accept' ? 'adopt' : 'reject',
        // On the deprecate branch `reason` carries the SUCCESSOR'S ID, not
        // prose — see the practice adapter's `reasonPrompts`. Anywhere else it
        // must not be forwarded: the backend treats a `superseded_by` on a
        // non-deprecate decision as a validation error, which would turn a
        // stale reason into a failed adopt.
        deprecating ? reason || undefined : undefined,
        item.payload?.seenStatus ?? undefined,
      );
      ports.refreshKnowledge();
      return;
    }

    case 'question': {
      // `sourceId` IS the session — the card is the session, not one question.
      const sessionId = item.payload?.sessionId ?? item.sourceId;
      if (branchId === 'builder') {
        // A deep-link is not a write, but it IS the only way this card can be
        // honoured — so a missing route is an error, not a quiet dismissal.
        const personaId = item.payload?.personaId;
        if (!ports.openBuilder || !personaId) {
          throw new Error('No builder route available for this question');
        }
        ports.openBuilder(personaId);
        return;
      }
      // ONE call for the whole session. `answer_build_question` resumes the
      // CLI, so a call per question resumes the same halted build N times.
      // `isDeferral` has already excluded the empty case; the guard stays so
      // the contract holds even for a caller that forgets to ask.
      const filled = filledAnswers(answers);
      if (Object.keys(filled).length === 0 || !sessionId) {
        throw new Error('This card has no answers to submit');
      }
      await ports.submitAnswers(sessionId, filled);
      return;
    }

    case 'policy': {
      const seen = item.payload?.seenStatus ?? undefined;
      if (verdict === 'accept') await ports.applyPolicy(item.sourceId, seen);
      else await ports.declinePolicy(item.sourceId, reason, seen);
      ports.refreshProposals();
      return;
    }

    case 'evolution': {
      // `reason` is the decision note, and it rides on BOTH verdicts even though
      // only a rejection can currently carry one — the command's `note`
      // parameter is verdict-agnostic and an approval note is a legitimate
      // record, so the router does not decide which acts may be annotated.
      await ports.decideEvolution(
        item.sourceId,
        verdict === 'accept',
        reason,
        item.payload?.seenStatus ?? undefined,
      );
      ports.refreshProposals();
      return;
    }

    case 'goal': {
      if (branchId === 'accept-kpi-batch') {
        // The ids ride in payload because the adapter is store-free and this
        // router is store-free too — neither can go and ask which other goals
        // sit on the KPI. See `goalToTriage`.
        const ids = (item.payload?.batchGoalIds ?? '').split(',').filter(Boolean);
        if (ids.length === 0) {
          throw new Error('This card has no KPI batch to accept');
        }
        // Concurrent, and `Promise.all` on purpose: one failed sign-off must
        // reach the caller rather than being averaged away by the others
        // succeeding. The queue restores what it optimistically removed.
        await Promise.all(ids.map((id) => ports.acceptGoal(id)));
        return;
      }
      if (branchId === 'open-board') {
        // A deep-link writes nothing, but it IS the only way this branch can be
        // honoured — so a missing route is an error, exactly as it is for a
        // question's builder link. Resolving the card for free would tell the
        // reviewer they had dealt with a goal that is still awaiting them.
        const projectId = item.payload?.projectId;
        if (!ports.openGoalBoard || !projectId) {
          throw new Error('No goals board route available for this goal');
        }
        ports.openGoalBoard(projectId);
        return;
      }
      if (verdict === 'accept') await ports.acceptGoal(item.sourceId);
      // The comment becomes the goal's `goal_rejected` signal ("Sent back: …"),
      // which is the only account the team gets of why finished work came back.
      else await ports.rejectGoal(item.sourceId, reason ?? '');
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Undo                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A verdict that has landed and could still be taken back.
 *
 * `producedStatus` is the whole point. An undo is not a special operation with
 * special rules — it is another write against an expectation, and the
 * expectation is what the reviewer's own verdict just put on the row. If someone
 * else has decided it since, the reopen loses the swap and says so with the same
 * message any other lost verdict uses, because it IS the same failure.
 */
export interface UndoableDecision {
  decision: TriageDecision;
  /** The status the write left on the row. */
  producedStatus: string;
  /** Epoch ms the verdict landed — what the undo window is measured from. */
  at: number;
}

/**
 * The status a verdict leaves on the row, or `null` when the row type has no
 * reverse door and must therefore not be offered an undo.
 *
 * Deriving it rather than reading it back from the write's return value is
 * deliberate: the deck resolves optimistically, so the row object it holds is
 * the one it rendered, and the honest expectation for the reverse is "the status
 * MY verdict was supposed to produce" — which is exactly what loses the swap if
 * the verdict never landed the way this surface thinks it did.
 */
export function reversibleStatus(decision: TriageDecision): string | null {
  const { item, verdict, branchId } = decision;
  switch (item.kind) {
    case 'idea':
      // `build` accepts and queues a task; the accept is what would be undone.
      return branchId === 'build' || verdict === 'accept' ? 'accepted' : 'rejected';
    case 'practice':
      return branchId === 'deprecate' ? 'deprecated' : verdict === 'accept' ? 'adopted' : 'rejected';
    // Reviews (the backend state machine has no path back to `pending`), build
    // questions (the CLI already resumed), policy proposals (the rule is
    // written, and there is deliberately no second policy writer), promotions
    // (the genome is on a live persona) and goals (an accepted goal is `done`
    // and no command reopens one; a sent-back goal is already back with its
    // team, which is not a state to undo from a queue). See
    // `rowWrites#ReopenOptions`. An undo button that cannot deliver is worse
    // than no undo button.
    default:
      return null;
  }
}

/**
 * Reverse a landed verdict. Callers MUST have obtained `record` from a decision
 * whose {@link reversibleStatus} was non-null.
 *
 * Throws on anything else, for the same reason `routeDecision` does: a silent
 * no-op here would tell a reviewer their approve was taken back when the row is
 * still approved.
 */
export async function undoDecision(
  record: UndoableDecision,
  ports: TriagePorts,
): Promise<void> {
  const { item } = record.decision;
  switch (item.kind) {
    case 'idea':
      await ports.reopenIdea(item.sourceId, record.producedStatus);
      return;
    case 'practice':
      await ports.reopenPractice(item.sourceId, record.producedStatus);
      ports.refreshKnowledge();
      return;
    default:
      throw new Error(`A ${item.kind} decision cannot be undone`);
  }
}
