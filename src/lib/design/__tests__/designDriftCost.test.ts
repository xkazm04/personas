/**
 * AN UNPRICED RUN IS NOT A FREE RUN, AND IT IS NOT A COST OVERRUN EITHER.
 *
 * `driftMiddleware` handed `costUsd ?? 0` to the drift detector, which turned
 * "nobody priced this run" into "this run was free" at the boundary. The
 * cost-overrun rule happened to survive it — its `> 0` guard rejects both — but
 * survival by accident is not a property, and the collapse is invisible to
 * every future reader of the field. The type is now `number | null` and these
 * tests pin the three outcomes apart.
 */
import { describe, it, expect } from 'vitest';
import { detectDesignDrift } from '../designDrift';

const ctx = {
  personaId: 'p-1',
  personaName: 'Tester',
  timeoutMs: 60_000,
  maxBudgetUsd: 1,
  lastDesignResult: null,
  recentFailureCount: 0,
};

const run = (costUsd: number | null) => ({
  status: 'completed',
  durationMs: 1_000,
  costUsd,
  errorMessage: null,
  toolSteps: null,
  executionId: 'e-1',
});

const costEvents = (costUsd: number | null) =>
  detectDesignDrift(run(costUsd), ctx).filter((e) => e.kind === 'cost_overrun');

describe('cost drift and the null/zero distinction', () => {
  it('an UNPRICED run is not reported as a cost overrun', () => {
    expect(costEvents(null)).toHaveLength(0);
  });

  it('a genuinely free run is not reported as a cost overrun either', () => {
    expect(costEvents(0)).toHaveLength(0);
  });

  it('a priced run over half its budget still is', () => {
    const events = costEvents(0.6);
    expect(events).toHaveLength(1);
    expect(events[0]?.severity).toBe('medium');
    expect(events[0]?.description).toContain('0.6000');
  });

  it('a priced run over 80% of budget escalates to high', () => {
    expect(costEvents(0.9)[0]?.severity).toBe('high');
  });

  it('a run under half its budget is quiet', () => {
    expect(costEvents(0.2)).toHaveLength(0);
  });

  it('no budget configured means no cost rule at all, priced or not', () => {
    const noBudget = { ...ctx, maxBudgetUsd: null };
    expect(detectDesignDrift(run(9_999), noBudget).filter((e) => e.kind === 'cost_overrun'))
      .toHaveLength(0);
  });
});
