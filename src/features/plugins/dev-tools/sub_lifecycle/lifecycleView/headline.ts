// The headline's pick, by MEASURED health: the step that most needs attention
// is the worst verdict on the journey, red > stale > amber > unmeasured, ties
// broken by step order. Green and instructed steps are never named. Pure, so
// the page and the unit test read the same rule.
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import type { HealthStep } from './layer1/healthModel';

/** Worst first. A verdict absent from this table is never the headline. */
const HEADLINE_RANK: Partial<Record<LifecycleHealth, number>> = {
  red: 0,
  stale: 1,
  amber: 2,
  unmeasured: 3,
};

/** The step the headline names, or null when every step is green or instructed. */
export function weakestByHealth(steps: readonly HealthStep[]): HealthStep | null {
  let pick: HealthStep | null = null;
  let pickRank = Number.POSITIVE_INFINITY;
  for (const s of steps) {
    const rank = HEADLINE_RANK[s.health];
    // Strictly lower only: an equal rank keeps the earlier step (step order).
    if (rank !== undefined && rank < pickRank) {
      pick = s;
      pickRank = rank;
    }
  }
  return pick;
}

/** A backend reason as a sentence body: trimmed, without its own closing full stop. */
export function reasonBody(reason: string | null): string | null {
  const r = reason?.trim().replace(/[.\s]+$/, '') ?? '';
  return r.length > 0 ? r : null;
}
