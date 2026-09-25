/**
 * decisionDeferral - the queue's skip/snooze ledger.
 *
 * The orb surfaces `queue[0]` and only while nothing else is pending, so a
 * decision the operator does not want to answer right now blocks every decision
 * behind it: hiding or collapsing the bubble keeps the SAME id pending, and the
 * queue never advances. With a dozen mixed approvals, incidents and reviews
 * waiting, the one at the front becomes a stop sign.
 *
 * Skip and Later are the two ways past it, and both are recorded here rather
 * than in a third local list: `buildQueue` filters against this ledger, so the
 * rule that decides what the orb shows lives in one place.
 *
 * Deliberately SESSION-SCOPED and in memory. A skipped approval is still
 * pending work - the backend row is untouched - so the next app start must
 * offer it again. Persisting a skip would turn "not now" into "never", which is
 * exactly the silence this queue exists to prevent.
 */

/** How long `Later` holds a decision back before it returns to the queue. */
export const DECISION_SNOOZE_MS = 10 * 60 * 1000;

/** `until` for a skip: the rest of this session. */
const SESSION = Number.POSITIVE_INFINITY;

const deferred = new Map<string, number>();

/** Hold `id` back until `untilMs`. */
export function deferDecision(id: string, durationMs: number = DECISION_SNOOZE_MS): number {
  const until = Date.now() + durationMs;
  deferred.set(id, until);
  return until;
}

/** Hold `id` back for the rest of the session (it returns on the next start). */
export function skipDecision(id: string): void {
  deferred.set(id, SESSION);
}

/** True while `id` is being held back. Expired entries are dropped on read, so
 *  the ledger cannot grow without bound across a long session. */
export function isDecisionDeferred(id: string, now: number = Date.now()): boolean {
  const until = deferred.get(id);
  if (until === undefined) return false;
  if (until <= now) {
    deferred.delete(id);
    return false;
  }
  return true;
}

/** Put `id` back in play immediately. */
export function undeferDecision(id: string): void {
  deferred.delete(id);
}

/** Test hatch + a clean slate for a new session. */
export function resetDecisionDeferrals(): void {
  deferred.clear();
}

/** How many decisions are currently held back. Diagnostics and tests. */
export function deferredCount(now: number = Date.now()): number {
  let n = 0;
  for (const id of [...deferred.keys()]) if (isDecisionDeferred(id, now)) n += 1;
  return n;
}
