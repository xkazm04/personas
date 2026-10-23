import { describe, it, expect } from 'vitest';
import { computeGlobalScore, computeGlobalUptime } from './useStatusPageData';
import type { CompositeHealthEntry } from './compositeHealthScore';

function makeEntry(overrides: Partial<CompositeHealthEntry>): CompositeHealthEntry {
  return {
    personaId: 'p1',
    personaName: 'P1',
    personaIcon: null,
    personaColor: null,
    score: 91,
    grade: 'healthy',
    successRateScore: 100,
    latencyScore: 100,
    costAnomalyScore: 100,
    healingScore: 100,
    stabilityScore: 100,
    successRate: 0.95,
    p95LatencyMs: 1500,
    costAnomalyCount: 0,
    openHealingIssues: 0,
    consecutiveFailures: 0,
    dailyStatuses: [],
    trend: 'stable',
    uptimePercent: 1,
    hasSlaData: true,
    ...overrides,
  };
}

describe('computeGlobalScore — no fabricated 100 on an empty status page', () => {
  it('regression: returns null (not 100) when there are no personas at all', () => {
    expect(computeGlobalScore([])).toBeNull();
  });

  it('averages real scores when personas exist', () => {
    expect(computeGlobalScore([makeEntry({ score: 80 }), makeEntry({ score: 60 })])).toBe(70);
  });

  it('leaves personas with no SLA data out of the average (their score is a default, not a reading)', () => {
    const entries = [
      makeEntry({ score: 95 }),
      makeEntry({ score: 90 }),
      // What computeCompositeHealth returns for a dormant persona: grade
      // 'unknown', score from the formula over defaults.
      makeEntry({ score: 70, grade: 'unknown', hasSlaData: false, successRate: null }),
    ];
    expect(computeGlobalScore(entries)).toBe(93);
  });

  it('returns null when no persona has SLA data', () => {
    expect(computeGlobalScore([makeEntry({ score: 70, grade: 'unknown', hasSlaData: false })])).toBeNull();
  });
});

describe('computeGlobalUptime — no fabricated 100% on an empty/dormant status page', () => {
  it('regression: returns null (not 1) when there are no personas at all', () => {
    expect(computeGlobalUptime([])).toBeNull();
  });

  it('regression: returns null when every persona has no recorded-activity day (uptimePercent null)', () => {
    const entries = [makeEntry({ uptimePercent: null }), makeEntry({ uptimePercent: null })];
    expect(computeGlobalUptime(entries)).toBeNull();
  });

  it('averages only personas that have activity data, excluding no-data ones', () => {
    const entries = [
      makeEntry({ uptimePercent: 1 }),
      makeEntry({ uptimePercent: 0.5 }),
      makeEntry({ uptimePercent: null }),
    ];
    expect(computeGlobalUptime(entries)).toBe(0.75);
  });
});
