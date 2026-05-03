import { describe, it, expect } from 'vitest';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { buildEvalGridData } from '../evalAggregation';

// -- Fixture helper --

interface ResultOverrides {
  scenario?: string;
  modelId?: string;
  ta?: number | null;
  oq?: number | null;
  pc?: number | null;
  cost?: number;
  duration?: number;
}

// Note: use `'key' in o` rather than `o.key ?? default` so explicit `null`
// overrides on ta/oq/pc pass through (the `??` operator would coerce null).
function pick<T>(o: ResultOverrides, key: keyof ResultOverrides, fallback: T): T {
  return (key in o ? (o as Record<string, unknown>)[key] : fallback) as T;
}

function evalResult(versionId: string, versionNumber: number, o: ResultOverrides = {}): LabEvalResult {
  return {
    id: `${versionId}-${pick(o, 'modelId', 'haiku')}-${pick(o, 'scenario', 's1')}`,
    runId: 'run-1',
    versionId,
    versionNumber,
    scenarioName: pick(o, 'scenario', 's1'),
    modelId: pick(o, 'modelId', 'haiku'),
    provider: 'anthropic',
    status: 'completed',
    outputPreview: null,
    toolAccuracyScore: pick(o, 'ta', 80),
    outputQualityScore: pick(o, 'oq', 70),
    protocolCompliance: pick(o, 'pc', 60),
    inputTokens: 0,
    outputTokens: 0,
    costUsd: pick(o, 'cost', 0.01),
    durationMs: pick(o, 'duration', 1000),
    rationale: null,
    suggestions: null,
    errorMessage: null,
    evalMethod: null,
    createdAt: '2026-05-01T00:00:00Z',
  };
}

describe('buildEvalGridData', () => {
  it('returns empty grid for empty input', () => {
    const out = buildEvalGridData([]);
    expect(out.versionAggs).toEqual([]);
    expect(out.versions).toEqual([]);
    expect(out.models).toEqual([]);
    expect(out.grid).toEqual({});
    expect(out.winnerId).toBeNull();
  });

  it('builds version aggregates from per-version results', () => {
    const out = buildEvalGridData([
      evalResult('v1', 1, { ta: 100, oq: 100, pc: 100 }),
      evalResult('v1', 1, { ta: 80, oq: 80, pc: 80, scenario: 's2' }),
      evalResult('v2', 2, { ta: 50, oq: 50, pc: 50 }),
    ]);
    expect(out.versionAggs).toHaveLength(2);
    const v1 = out.versionAggs.find((v) => v.versionId === 'v1')!;
    expect(v1.avgToolAccuracy).toBe(90); // (100+80)/2
    expect(v1.compositeScore).toBe(90);
    expect(v1.count).toBe(2);
  });

  it('picks winnerId by composite score (highest first)', () => {
    const out = buildEvalGridData([
      evalResult('weak', 1, { ta: 30 }),
      evalResult('strong', 2, { ta: 95 }),
      evalResult('mid', 3, { ta: 60 }),
    ]);
    expect(out.winnerId).toBe('strong');
    expect(out.versions).toEqual(['strong', 'mid', 'weak']);
  });

  it('builds version × model grid', () => {
    const out = buildEvalGridData([
      evalResult('v1', 1, { modelId: 'haiku', ta: 100 }),
      evalResult('v1', 1, { modelId: 'sonnet', ta: 80 }),
      evalResult('v2', 2, { modelId: 'haiku', ta: 60 }),
    ]);
    expect(out.models).toContain('haiku');
    expect(out.models).toContain('sonnet');
    expect(out.grid['v1']!['haiku']!.avgToolAccuracy).toBe(100);
    expect(out.grid['v1']!['sonnet']!.avgToolAccuracy).toBe(80);
    expect(out.grid['v2']!['haiku']!.avgToolAccuracy).toBe(60);
    expect(out.grid['v2']!['sonnet']).toBeUndefined();
  });

  it('excludes null scores from per-metric averages (not treated as 0)', () => {
    const out = buildEvalGridData([
      evalResult('v1', 1, { ta: 100, oq: null, pc: 100 }),
      evalResult('v1', 1, { ta: 80, oq: 60, pc: 80 }),
    ]);
    const v1 = out.versionAggs[0]!;
    expect(v1.avgToolAccuracy).toBe(90); // (100+80)/2
    expect(v1.avgOutputQuality).toBe(60); // null excluded, not (0+60)/2=30
  });

  it('counts duration and cost across all results regardless of null scores', () => {
    const out = buildEvalGridData([
      evalResult('v1', 1, { ta: null, oq: null, pc: null, cost: 0.10, duration: 1000 }),
      evalResult('v1', 1, { ta: null, oq: null, pc: null, cost: 0.30, duration: 3000 }),
    ]);
    const v1 = out.versionAggs[0]!;
    expect(v1.totalCost).toBeCloseTo(0.40, 5);
    expect(v1.avgDuration).toBe(2000);
    // All scores null → averages fall back to 0
    expect(v1.avgToolAccuracy).toBe(0);
    expect(v1.compositeScore).toBe(0);
  });

  it('aggregates duplicate (versionId, modelId) cells', () => {
    const out = buildEvalGridData([
      evalResult('v1', 1, { modelId: 'haiku', ta: 60, scenario: 's1' }),
      evalResult('v1', 1, { modelId: 'haiku', ta: 100, scenario: 's2' }),
    ]);
    expect(out.grid['v1']!['haiku']!.avgToolAccuracy).toBe(80); // (60+100)/2
    expect(out.grid['v1']!['haiku']!.count).toBe(2);
  });
});
