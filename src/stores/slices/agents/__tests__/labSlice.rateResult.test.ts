import { describe, it, expect, beforeEach, vi } from 'vitest';

const { labRateResult } = vi.hoisted(() => ({ labRateResult: vi.fn() }));
vi.mock('@/api/agents/lab', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  labRateResult,
  labGetActiveProgress: vi.fn().mockResolvedValue([]),
}));

import { useAgentStore } from '../../../agentStore';

describe('rateResult reports whether the rating was persisted', () => {
  beforeEach(() => {
    labRateResult.mockReset();
    useAgentStore.setState({ userRatings: {} });
  });

  it('resolves true and stores the rating when the write lands', async () => {
    labRateResult.mockResolvedValue({ id: 'r1', runId: 'run', resultId: null, scenarioName: 's', rating: 5, feedback: null, createdAt: '' });
    await expect(useAgentStore.getState().rateResult('run', null, 's', 5)).resolves.toBe(true);
    expect(useAgentStore.getState().userRatings['run']).toHaveLength(1);
  });

  it('resolves false and stores nothing when the write is rejected', async () => {
    labRateResult.mockRejectedValue({ error: 'rating out of range', kind: 'validation' });
    await expect(useAgentStore.getState().rateResult('run', null, 's', 9)).resolves.toBe(false);
    expect(useAgentStore.getState().userRatings['run']).toBeUndefined();
  });
});
