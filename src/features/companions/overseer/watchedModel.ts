// Pure model behind the Overseer's Watched pipelines cards: a pipeline's steps
// split into their two lanes, counted by verdict, and judged by its worst
// verdict (what the card's mark says). No React, no i18n.
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleWatchedStep } from '@/lib/bindings/LifecycleWatchedStep';

/** Verdicts by how much they need the reader, worst first; instructed last (nothing measures it). */
export const BY_SEVERITY: readonly LifecycleHealth[] = ['red', 'amber', 'stale', 'unmeasured', 'green', 'instructed'];

export function lanesOf(steps: readonly LifecycleWatchedStep[]) {
  return {
    before: steps.filter((s) => s.phase === 'before'),
    after: steps.filter((s) => s.phase === 'after'),
  };
}

export function verdictTally(steps: readonly LifecycleWatchedStep[]): Record<LifecycleHealth, number> {
  const t: Record<LifecycleHealth, number> = { red: 0, amber: 0, stale: 0, unmeasured: 0, green: 0, instructed: 0 };
  for (const s of steps) t[s.health] += 1;
  return t;
}

export type PipelineStanding = 'red' | 'amber' | 'open' | 'green' | 'none';

/**
 * What the card's mark says: failing beats at risk beats "not every step is
 * measured" (stale or not measured); green only when every measurable step
 * is. A pipeline with no measurable step has no standing.
 */
export function standingOf(steps: readonly LifecycleWatchedStep[]): PipelineStanding {
  const t = verdictTally(steps);
  if (t.red > 0) return 'red';
  if (t.amber > 0) return 'amber';
  if (t.stale > 0 || t.unmeasured > 0) return 'open';
  return t.green > 0 ? 'green' : 'none';
}
