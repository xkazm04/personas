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
  acceptIdea: (id: string) => Promise<unknown>;
  rejectIdea: (id: string, reason?: string) => Promise<unknown>;
  decideKnowledge: (id: string, verdict: 'adopt' | 'reject' | 'deprecate') => Promise<unknown>;
  /** Fired after a practice verdict so the workspace centre re-reads. */
  refreshKnowledge: () => void;
  submitAnswers: (sessionId: string, answers: Record<string, string>) => Promise<void>;
  /** Deep-link to the persona builder. Absent when the host has no route. */
  openBuilder?: (personaId: string) => void;
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

    case 'idea':
      if (branchId === 'build') {
        await ports.createTask(
          item.title,
          item.payload?.projectId ?? undefined,
          item.body,
          item.sourceId,
        );
        await ports.acceptIdea(item.sourceId);
      } else if (verdict === 'accept') {
        await ports.acceptIdea(item.sourceId);
      } else {
        await ports.rejectIdea(item.sourceId, reason);
      }
      return;

    case 'practice':
      await ports.decideKnowledge(
        item.sourceId,
        branchId === 'deprecate' ? 'deprecate' : verdict === 'accept' ? 'adopt' : 'reject',
      );
      ports.refreshKnowledge();
      return;

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
  }
}
