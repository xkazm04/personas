/**
 * "REPEATED FAILURES" MUST COUNT THE STREAK THE DETECTOR EXPECTS.
 *
 * `detectDesignDrift` reads `recentFailureCount` as the PRIOR runs' streak: it
 * fires at >= 2 and titles the event `recentFailureCount + 1 consecutive`. The
 * drift middleware counted the current run into it as well, so two failures in
 * a row raised "Repeated failures" and three were titled "4 consecutive".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DesignDriftEvent } from '@/lib/design/designDrift';

const store = vi.hoisted(() => ({
  state: { personas: [] as unknown[], designDriftEvents: [] as unknown[] },
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: {
    getState: () => store.state,
    setState: (patch: Record<string, unknown>) => { Object.assign(store.state, patch); },
  },
}));

import { registerDriftMiddleware } from '../middleware/driftMiddleware';
import { createPipelineTrace, runMiddleware } from '../pipeline';

async function finish(prior: string[]) {
  await runMiddleware('frontend_complete', {
    executionId: 'e-now',
    finalStatus: 'failed',
    personaId: 'p1',
    durationMs: 1000,
    costUsd: null,
    errorMessage: null,
    recentExecutions: prior.map((status) => ({ persona_id: 'p1', status })),
  }, createPipelineTrace('e-now'));
  return (store.state.designDriftEvents as DesignDriftEvent[]).filter((e) => e.kind === 'repeated_failure');
}

beforeEach(() => {
  localStorage.clear();
  store.state = {
    personas: [{ id: 'p1', name: 'Agent', timeout_ms: 600_000, max_budget_usd: null, last_design_result: null }],
    designDriftEvents: [],
  };
  registerDriftMiddleware();
});

describe('drift middleware failure streak', () => {
  it('two failures in a row are not yet "repeated"', async () => {
    expect(await finish(['failed', 'completed'])).toHaveLength(0);
  });

  it('three in a row are titled as three', async () => {
    const events = await finish(['failed', 'failed', 'completed']);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Repeated failures (3 consecutive)');
  });

  it('a still-running row does not break the streak, and a dead process extends it', async () => {
    const events = await finish(['running', 'incomplete', 'failed', 'completed']);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Repeated failures (3 consecutive)');
  });
});
