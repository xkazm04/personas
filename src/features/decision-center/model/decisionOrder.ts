/**
 * decisionOrder — the cross-type ordering law (tier, then weight, then oldest,
 * then identity).
 *
 * Tier is the FIRST key and the only new one. Inside a tier the order is the
 * triage deck's existing law, `compareOrder` (weight desc, createdAt asc, id),
 * reused rather than restated — two ordering laws over overlapping queues is
 * how one surface starts dealing a card the other buries.
 *
 * The identity tiebreak at the end makes the order TOTAL: two items with the
 * same tier, weight and second never trade places between polls, and an item
 * inserted by a refresh lands in one fixed position regardless of where the
 * backend happened to return it.
 *
 * React-free and store-free.
 */
import { compareOrder } from '@/features/agents/quick-answer/triage/triageTypes';

import type { DecisionItem, DecisionTier } from './decisionModel';

/** Incident severities that block real work (tier 1). */
const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high']);

/**
 * True when a review is HOLDING A TEAM STEP.
 *
 * The same signal `reviewToTriage` uses for its blocking alert
 * (`triageAdapters.ts`: `blocking = !!(review.assignment_id || review.step_id)`),
 * read from the machine payload it writes rather than from the alert, so a copy
 * change to the alert can never move a card between tiers.
 */
function holdsTeamStep(item: DecisionItem): boolean {
  return Boolean(item.payload?.assignmentId || item.payload?.stepId);
}

/** Which tier an item belongs to. See `DecisionTier`. */
export function decisionTier(item: DecisionItem): DecisionTier {
  switch (item.kind) {
    case 'approval':
      return 1;
    case 'incident':
      return BLOCKING_SEVERITIES.has((item.severity ?? '').toLowerCase()) ? 1 : 2;
    case 'review':
      return holdsTeamStep(item) ? 1 : 2;
    case 'message':
    case 'report':
      return 3;
    default:
      return 2;
  }
}

/** Total order over decision items. Negative = `a` first. */
export function compareDecision(a: DecisionItem, b: DecisionItem): number {
  const tier = decisionTier(a) - decisionTier(b);
  if (tier !== 0) return tier;
  return compareOrder(a.weight, a.createdAt, b.weight, b.createdAt, a.id, b.id);
}
