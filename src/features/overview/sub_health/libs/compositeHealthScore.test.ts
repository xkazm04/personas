import { describe, it, expect } from 'vitest';
import { WEIGHTS, sumWeights, TREND_NEUTRAL_BAND } from './compositeHealthScore';

describe('compositeHealthScore weights', () => {
  it('WEIGHTS sum to exactly 1.0 (within floating-point epsilon)', () => {
    expect(Math.abs(sumWeights() - 1.0)).toBeLessThan(1e-9);
  });

  it('exposes all five expected weight keys', () => {
    expect(Object.keys(WEIGHTS).sort()).toEqual(
      ['costAnomaly', 'healing', 'latency', 'slaCompliance', 'successRate'],
    );
  });

  it('each weight is between 0 and 1', () => {
    for (const v of Object.values(WEIGHTS)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('sumWeights fails fast on drifted weights', () => {
    const drifted = { ...WEIGHTS, successRate: 0.40 } as unknown as typeof WEIGHTS;
    expect(Math.abs(sumWeights(drifted) - 1.0)).toBeGreaterThan(1e-9);
  });
});

describe('TREND_NEUTRAL_BAND', () => {
  it('is 2% — the observed daily success-rate noise floor', () => {
    expect(TREND_NEUTRAL_BAND).toBe(0.02);
  });
});
