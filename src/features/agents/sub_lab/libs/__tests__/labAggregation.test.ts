import { describe, it, expect } from 'vitest';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import {
  aggregateArenaResults,
  aggregateAbResults,
  aggregateMatrixResults,
} from '../labAggregation';

// -- Fixture helpers --

interface ResultOverrides {
  scenario?: string;
  ta?: number | null;
  oq?: number | null;
  pc?: number | null;
  cost?: number;
  duration?: number;
}

// Note: use `'key' in o ? o.key : default` rather than `o.key ?? default` so
// that explicit `null` overrides for ta/oq/pc are preserved (the `??` operator
// would coerce the null to the default).
function pick<T>(o: ResultOverrides, key: keyof ResultOverrides, fallback: T): T {
  return (key in o ? (o as Record<string, unknown>)[key] : fallback) as T;
}

function arenaResult(modelId: string, provider: string, o: ResultOverrides = {}): LabArenaResult {
  return {
    id: `${modelId}-${pick(o, 'scenario', 's1')}`,
    runId: 'run-1',
    scenarioName: pick(o, 'scenario', 's1'),
    modelId,
    provider,
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

function abResult(versionId: string, versionNumber: number, o: ResultOverrides = {}): LabAbResult {
  return {
    id: `${versionId}-${pick(o, 'scenario', 's1')}`,
    runId: 'run-1',
    versionId,
    versionNumber,
    scenarioName: pick(o, 'scenario', 's1'),
    modelId: 'haiku',
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

function matrixResult(variant: string, o: ResultOverrides = {}): LabMatrixResult {
  return {
    id: `${variant}-${pick(o, 'scenario', 's1')}`,
    runId: 'run-1',
    variant,
    scenarioName: pick(o, 'scenario', 's1'),
    modelId: 'haiku',
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

// -- Arena --

describe('aggregateArenaResults', () => {
  it('returns empty aggregation for empty input', () => {
    const out = aggregateArenaResults([]);
    expect(out.models).toEqual([]);
    expect(out.scenarios).toEqual([]);
    expect(out.aggregates).toEqual([]);
    expect(out.bestModelId).toBeNull();
  });

  it('groups by model and computes per-model averages', () => {
    const out = aggregateArenaResults([
      arenaResult('haiku', 'anthropic', { scenario: 's1', ta: 100, oq: 100, pc: 100 }),
      arenaResult('haiku', 'anthropic', { scenario: 's2', ta: 80, oq: 80, pc: 80 }),
      arenaResult('opus', 'anthropic', { scenario: 's1', ta: 50, oq: 50, pc: 50 }),
    ]);
    expect(out.models).toEqual(['haiku', 'opus']);
    const haiku = out.aggregates.find((a) => a.modelId === 'haiku')!;
    expect(haiku.avgToolAccuracy).toBe(90);
    expect(haiku.avgOutputQuality).toBe(90);
    expect(haiku.avgProtocolCompliance).toBe(90);
    expect(haiku.compositeScore).toBe(90);
    expect(haiku.count).toBe(2);
  });

  it('excludes null scores from per-metric averages', () => {
    const out = aggregateArenaResults([
      arenaResult('haiku', 'anthropic', { scenario: 's1', ta: 100, oq: null, pc: 100 }),
      arenaResult('haiku', 'anthropic', { scenario: 's2', ta: 80, oq: 60, pc: 80 }),
    ]);
    const haiku = out.aggregates[0]!;
    // tool_accuracy: (100 + 80) / 2 = 90
    expect(haiku.avgToolAccuracy).toBe(90);
    // output_quality: 60 / 1 = 60 (null excluded, not treated as 0)
    expect(haiku.avgOutputQuality).toBe(60);
  });

  it('sorts aggregates by compositeScore descending; bestModelId is the top', () => {
    const out = aggregateArenaResults([
      arenaResult('weak', 'p', { ta: 30, oq: 30, pc: 30 }),
      arenaResult('strong', 'p', { ta: 90, oq: 90, pc: 90 }),
      arenaResult('mid', 'p', { ta: 60, oq: 60, pc: 60 }),
    ]);
    expect(out.aggregates.map((a) => a.modelId)).toEqual(['strong', 'mid', 'weak']);
    expect(out.bestModelId).toBe('strong');
  });

  it('builds scenario × model matrix with last result wins on collision', () => {
    const r1 = arenaResult('haiku', 'p', { scenario: 's1', ta: 50 });
    const r2 = arenaResult('haiku', 'p', { scenario: 's1', ta: 90 });
    const out = aggregateArenaResults([r1, r2]);
    expect(out.matrix['s1']!['haiku']).toBe(r2);
  });

  it('sums cost and averages duration', () => {
    const out = aggregateArenaResults([
      arenaResult('haiku', 'p', { cost: 0.10, duration: 1000 }),
      arenaResult('haiku', 'p', { cost: 0.30, duration: 3000 }),
    ]);
    const haiku = out.aggregates[0]!;
    expect(haiku.totalCost).toBeCloseTo(0.40, 5);
    expect(haiku.avgDuration).toBe(2000);
  });
});

// -- A/B --

describe('aggregateAbResults', () => {
  it('returns empty aggregation for empty input', () => {
    const out = aggregateAbResults([]);
    expect(out.versionAggs).toEqual([]);
    expect(out.winnerId).toBeNull();
  });

  it('groups by versionId and picks winner by composite score', () => {
    const out = aggregateAbResults([
      abResult('v1', 1, { ta: 60, oq: 60, pc: 60 }),
      abResult('v2', 2, { ta: 80, oq: 80, pc: 80 }),
    ]);
    expect(out.winnerId).toBe('v2');
    expect(out.versionAggs[0]!.versionId).toBe('v2');
  });

  it('matrix per scenario stores arrays (multiple runs per scenario × version)', () => {
    const r1 = abResult('v1', 1, { scenario: 's1' });
    const r2 = abResult('v1', 1, { scenario: 's1' });
    const out = aggregateAbResults([r1, r2]);
    expect(out.matrix['s1']!['v1']).toHaveLength(2);
  });

  it('preserves versionNumber in aggregates', () => {
    const out = aggregateAbResults([
      abResult('v1', 7),
      abResult('v2', 12),
    ]);
    expect(out.versionAggs.find((v) => v.versionId === 'v1')!.versionNumber).toBe(7);
    expect(out.versionAggs.find((v) => v.versionId === 'v2')!.versionNumber).toBe(12);
  });
});

// -- Matrix --

describe('aggregateMatrixResults', () => {
  it('puts the "current" variant first in variantAggs', () => {
    const out = aggregateMatrixResults([
      matrixResult('draft', { ta: 90 }),
      matrixResult('current', { ta: 60 }),
    ]);
    expect(out.variantAggs[0]!.variant).toBe('current');
    expect(out.variantAggs[1]!.variant).toBe('draft');
  });

  it('groups multiple results per variant per scenario into arrays', () => {
    const r1 = matrixResult('draft', { scenario: 's1' });
    const r2 = matrixResult('draft', { scenario: 's1' });
    const out = aggregateMatrixResults([r1, r2]);
    expect(out.matrix['s1']!['draft']).toHaveLength(2);
  });

  it('returns empty for empty input', () => {
    expect(aggregateMatrixResults([])).toEqual({
      variantAggs: [],
      scenarios: [],
      matrix: {},
    });
  });
});
