import { describe, it, expect, vi } from 'vitest';

// The component module imports the store and IPC; only the pure helpers are under test.
vi.mock('@/stores/agentStore', () => ({ useAgentStore: { getState: () => ({}) } }));

import { avgScores, weakestMetric } from '../ImprovePromptButton';

const row = (ta: number | null, oq: number | null, pc: number | null) => ({
  toolAccuracyScore: ta,
  outputQualityScore: oq,
  protocolCompliance: pc,
});

describe('Improve hint - an unscored metric is never the "weakest area"', () => {
  it('regression: a run that never scored tool accuracy does not name it at 0', () => {
    const scores = avgScores([row(null, 70, 90), row(null, 60, 80)]);
    expect(scores?.ta).toBeNull();
    expect(weakestMetric(scores)).toEqual({ key: 'oq', v: 65 });
  });

  it('a genuine 0 is still the weakest', () => {
    expect(weakestMetric(avgScores([row(0, 70, 90)]))).toEqual({ key: 'ta', v: 0 });
  });

  it('nothing scored names nothing', () => {
    expect(weakestMetric(avgScores([row(null, null, null)]))).toBeNull();
    expect(weakestMetric(avgScores([]))).toBeNull();
  });
});
