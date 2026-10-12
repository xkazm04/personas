/**
 * orbLoad — which roster chips the orb loads ITEMS for, decided from the
 * counts it gets for free.
 *
 * The orb is mounted for the whole session. Loading the gates chip mounts the
 * triage deck's machinery (its owned fetches and the pending-review list poll)
 * and loading incidents polls the incident list — every 30 s, whether or not
 * anything is waiting. So items load only while the shared counts read
 * (`dev_tools_pending_counts`, already polled for the title-bar badge) says
 * there is something the orb could surface:
 *
 *  - `gates` while a review or a companion approval is pending. Build
 *    questions are part of the gates CHIP but not the orb's to decide, so they
 *    do not count here;
 *  - `incidents` while an incident is BLOCKING (critical/high) — the only
 *    incidents the orb surfaces (`isOrbEligible`);
 *  - both while the counts read FAILED: a read that did not answer cannot
 *    prove the queue is empty, and the orb must surface unconditionally;
 *  - nothing before the first read lands, and nothing when it says zero —
 *    an empty queue costs the orb only the shared counts read.
 *
 * React-free.
 */
import type { DecisionChip } from '@/features/decision-center/model/decisionModel';
import type { PendingCounts } from '@/lib/bindings/PendingCounts';

const BOTH: readonly DecisionChip[] = ['gates', 'incidents'];
const GATES: readonly DecisionChip[] = ['gates'];
const INCIDENTS: readonly DecisionChip[] = ['incidents'];
const NONE: readonly DecisionChip[] = [];

/** Stable arrays, so a caller can pass the result straight to `useDecisionRoster`. */
export function orbLoad(pending: PendingCounts | null, failed: boolean): readonly DecisionChip[] {
  if (failed) return BOTH;
  if (!pending) return NONE;
  const gates = pending.manualReviews + pending.companionApprovals > 0;
  const incidents = pending.blockingIncidents > 0;
  if (gates && incidents) return BOTH;
  if (gates) return GATES;
  if (incidents) return INCIDENTS;
  return NONE;
}
