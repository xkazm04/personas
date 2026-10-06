/**
 * decisionOrder — the cross-type ordering law (tier, then weight, then oldest,
 * then identity). WP0 stub: signatures are final, bodies land in package A2.
 */
import type { DecisionItem, DecisionTier } from './decisionModel';

/** Which tier an item belongs to. See `DecisionTier`. */
export function decisionTier(item: DecisionItem): DecisionTier {
  void item;
  throw new Error('decisionTier: not implemented (package A2)');
}

/** Total order over decision items. Negative = `a` first. */
export function compareDecision(a: DecisionItem, b: DecisionItem): number {
  void a;
  void b;
  throw new Error('compareDecision: not implemented (package A2)');
}
