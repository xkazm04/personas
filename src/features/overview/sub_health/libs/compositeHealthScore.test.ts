import { describe, it, expect } from 'vitest';
import {
  WEIGHTS,
  sumWeights,
  HEARTBEAT_WEIGHTS,
  sumHeartbeatWeights,
  TREND_NEUTRAL_BAND,
  GRADE_THRESHOLDS,
  computeGrade,
  computeHeartbeatScore,
  scoreBudget,
} from './compositeHealthScore';

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

describe('HEARTBEAT_WEIGHTS', () => {
  it('sum to exactly 1.0 (within floating-point epsilon)', () => {
    expect(Math.abs(sumHeartbeatWeights() - 1.0)).toBeLessThan(1e-9);
  });

  it('exposes the four heartbeat sub-score keys', () => {
    expect(Object.keys(HEARTBEAT_WEIGHTS).sort()).toEqual(
      ['budget', 'healing', 'rollback', 'success'],
    );
  });
});

describe('computeGrade (single grade-threshold function)', () => {
  it('bands scores at the shared thresholds', () => {
    expect(computeGrade(100)).toBe('healthy');
    expect(computeGrade(GRADE_THRESHOLDS.healthy)).toBe('healthy');
    expect(computeGrade(GRADE_THRESHOLDS.healthy - 1)).toBe('degraded');
    expect(computeGrade(GRADE_THRESHOLDS.degraded)).toBe('degraded');
    expect(computeGrade(GRADE_THRESHOLDS.degraded - 1)).toBe('critical');
    expect(computeGrade(1)).toBe('critical');
    expect(computeGrade(0)).toBe('unknown');
  });
});

describe('scoreBudget — strictly monotonic (regression: the 0.8 upward jump)', () => {
  it('never rises as the budget ratio worsens across 0..1.2', () => {
    let prev = Infinity;
    for (let ratio = 0; ratio <= 1.2 + 1e-9; ratio += 0.01) {
      const score = scoreBudget(ratio);
      expect(score).toBeLessThanOrEqual(prev + 1e-9);
      prev = score;
    }
  });

  it('is strictly decreasing on [0, 1)', () => {
    for (let ratio = 0; ratio < 0.99; ratio += 0.05) {
      expect(scoreBudget(ratio)).toBeGreaterThan(scoreBudget(ratio + 0.01));
    }
  });

  it('kills the old non-monotonic jump: 0.79 scores lower-or-equal than 0.81 is FALSE', () => {
    // Old curve: score(0.79)=21 but score(0.81)=30 (rose as budget worsened).
    expect(scoreBudget(0.79)).toBeGreaterThan(scoreBudget(0.81));
  });

  it('anchors: 0 → 100, 1 → 0, over-budget → 0', () => {
    expect(scoreBudget(0)).toBe(100);
    expect(scoreBudget(1)).toBe(0);
    expect(scoreBudget(1.2)).toBe(0);
  });
});

describe('computeHeartbeatScore — pinned unified math', () => {
  it('perfect signals score 100', () => {
    expect(computeHeartbeatScore(100, 0, 0, 0)).toBe(100);
  });

  it('pins the weighted composite for a mixed persona', () => {
    // success=80 → 80*0.4=32; healing 2/d → (100-50)=50*0.2=10;
    // rollback 1 → (100-33)=67*0.2=13.4; budget 0.5 → 50*0.2=10 ⇒ 65.4 → 65
    expect(computeHeartbeatScore(80, 2, 1, 0.5)).toBe(65);
  });

  it('over-budget zeroes only the budget slice, not the whole score', () => {
    // success=100→40; healing 0→20; rollback 0→20; budget 1.1→0 ⇒ 80
    expect(computeHeartbeatScore(100, 0, 0, 1.1)).toBe(80);
  });
});

describe('TREND_NEUTRAL_BAND', () => {
  it('is 2% — the observed daily success-rate noise floor', () => {
    expect(TREND_NEUTRAL_BAND).toBe(0.02);
  });
});
