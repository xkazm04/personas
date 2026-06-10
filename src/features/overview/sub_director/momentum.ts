import type { DirectorRosterEntry } from '@/api/director';

/**
 * Coaching momentum — is an agent's latest score better, worse, or unchanged
 * versus its previous review? Pure, client-side, derived from the score trend
 * the roster already carries. Turns the static scorecard into an "is the fleet
 * getting better?" read. Shared by the portfolio summary, the per-row indicator,
 * and the momentum filter facet.
 */

export type Momentum = 'improving' | 'declining' | 'flat';

/** Most-positive first — drives the summary strip order. */
export const MOMENTUM_ORDER: Momentum[] = ['improving', 'flat', 'declining'];

export const MOMENTUM_TONE: Record<Momentum, string> = {
  improving: 'var(--status-success)',
  flat: 'var(--muted-foreground)',
  declining: 'var(--status-error)',
};

/** Signed score delta since the previous review; 0 when there aren't two scored reviews. */
export function rosterScoreDelta(r: DirectorRosterEntry): number {
  const n = r.scoreTrend.length;
  if (n < 2) return 0;
  return r.scoreTrend[n - 1]! - r.scoreTrend[n - 2]!;
}

/** Momentum bucket for one agent. Flat when fewer than two scored reviews. */
export function rosterMomentum(r: DirectorRosterEntry): Momentum {
  const d = rosterScoreDelta(r);
  if (d > 0) return 'improving';
  if (d < 0) return 'declining';
  return 'flat';
}

/** Portfolio tally of how many agents sit in each momentum bucket. */
export function momentumCounts(roster: DirectorRosterEntry[]): Record<Momentum, number> {
  const counts: Record<Momentum, number> = { improving: 0, flat: 0, declining: 0 };
  for (const r of roster) counts[rosterMomentum(r)] += 1;
  return counts;
}
