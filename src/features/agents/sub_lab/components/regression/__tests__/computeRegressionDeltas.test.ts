import { describe, it, expect } from 'vitest';
import { computeRegressionDeltas } from '../computeRegressionDeltas';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

/**
 * These tests pin the single delta selector that RegressionResultsView,
 * RegressionPanelGate, and RegressionPanelConsole all consume. They rely on
 * the canonical composite weighting (0.4 / 0.4 / 0.2 — the static defaults in
 * evalFramework before any IPC reweight), same as evalFramework.test.ts.
 */
function row(overrides: Partial<LabEvalResult> = {}): LabEvalResult {
  return {
    id: 'id',
    runId: 'run',
    versionId: 'v',
    versionNumber: 1,
    scenarioName: 'scenario',
    modelId: 'model',
    provider: 'anthropic',
    status: 'completed',
    outputPreview: null,
    toolAccuracyScore: 100,
    outputQualityScore: 100,
    protocolCompliance: 100,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    durationMs: 0,
    rationale: null,
    suggestions: null,
    errorMessage: null,
    evalMethod: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeRegressionDeltas', () => {
  it('returns an all-zero, passing summary for empty inputs', () => {
    const s = computeRegressionDeltas([], [], 5);
    expect(s.deltas).toEqual([]);
    expect(s.avgToolAccuracy).toBe(0);
    expect(s.avgOutputQuality).toBe(0);
    expect(s.avgProtocol).toBe(0);
    expect(s.overallDelta).toBe(0);
    expect(s.failureCount).toBe(0);
    expect(s.improvementCount).toBe(0);
    expect(s.overallVerdict).toBe('pass');
  });

  it('marks a composite gain as improved with per-dimension deltas', () => {
    const baseline = [row({ scenarioName: 'a', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 })];
    const current = [row({ scenarioName: 'a', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 })];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.deltas).toHaveLength(1);
    expect(s.deltas[0]).toMatchObject({
      baselineComposite: 50,
      currentComposite: 60,
      delta: 10,
      deltaToolAccuracy: 10,
      deltaOutputQuality: 10,
      deltaProtocol: 10,
      verdict: 'improved',
    });
    expect(s.improvementCount).toBe(1);
    expect(s.overallVerdict).toBe('improved');
    expect(s.overallDelta).toBe(10);
  });

  it('flags a drop beyond the threshold as a failure', () => {
    const baseline = [row({ scenarioName: 'a', toolAccuracyScore: 80, outputQualityScore: 80, protocolCompliance: 80 })];
    const current = [row({ scenarioName: 'a', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 })];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.deltas[0].delta).toBe(-20);
    expect(s.deltas[0].verdict).toBe('fail');
    expect(s.failureCount).toBe(1);
    expect(s.overallVerdict).toBe('fail');
  });

  it('treats a drop within the threshold as a pass', () => {
    const baseline = [row({ scenarioName: 'a', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 })];
    const current = [row({ scenarioName: 'a', toolAccuracyScore: 57, outputQualityScore: 57, protocolCompliance: 57 })];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.deltas[0].delta).toBe(-3);
    expect(s.deltas[0].verdict).toBe('pass');
    expect(s.failureCount).toBe(0);
    expect(s.improvementCount).toBe(0);
    expect(s.overallVerdict).toBe('pass');
  });

  it('failure dominates the overall verdict over an improvement', () => {
    const baseline = [
      row({ scenarioName: 'a', toolAccuracyScore: 80, outputQualityScore: 80, protocolCompliance: 80 }),
      row({ scenarioName: 'b', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 }),
    ];
    const current = [
      row({ scenarioName: 'a', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 }),
      row({ scenarioName: 'b', toolAccuracyScore: 70, outputQualityScore: 70, protocolCompliance: 70 }),
    ];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.failureCount).toBe(1);
    expect(s.improvementCount).toBe(1);
    expect(s.overallVerdict).toBe('fail');
    // overallDelta = round((-20 + 20) / 2) = 0
    expect(s.overallDelta).toBe(0);
  });

  it('skips rows whose current or baseline metrics are unscored', () => {
    const baseline = [
      row({ scenarioName: 'a', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 }),
      row({ scenarioName: 'b', toolAccuracyScore: null }),
    ];
    const current = [
      row({ scenarioName: 'a', outputQualityScore: null }), // current null → skip
      row({ scenarioName: 'b', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 }), // baseline null → skip
    ];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.deltas).toEqual([]);
    expect(s.overallVerdict).toBe('pass');
  });

  it('only matches baseline rows with the same scenario AND model', () => {
    const baseline = [row({ scenarioName: 'a', modelId: 'gpt', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 })];
    const current = [row({ scenarioName: 'a', modelId: 'claude', toolAccuracyScore: 60, outputQualityScore: 60, protocolCompliance: 60 })];
    const s = computeRegressionDeltas(baseline, current, 5);
    expect(s.deltas).toEqual([]);
  });

  it('averages per-dimension deltas across comparable pairs (rounded)', () => {
    const baseline = [
      row({ scenarioName: 'a', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 }),
      row({ scenarioName: 'b', toolAccuracyScore: 50, outputQualityScore: 50, protocolCompliance: 50 }),
    ];
    const current = [
      row({ scenarioName: 'a', toolAccuracyScore: 60, outputQualityScore: 70, protocolCompliance: 40 }),
      row({ scenarioName: 'b', toolAccuracyScore: 70, outputQualityScore: 50, protocolCompliance: 50 }),
    ];
    const s = computeRegressionDeltas(baseline, current, 5);
    // TA deltas: +10, +20 → avg 15 ; OQ: +20, 0 → 10 ; PC: -10, 0 → -5
    expect(s.avgToolAccuracy).toBe(15);
    expect(s.avgOutputQuality).toBe(10);
    expect(s.avgProtocol).toBe(-5);
  });
});
