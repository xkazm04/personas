import { describe, it, expect } from 'vitest';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import {
  ALL_COMPARE_MODELS,
  FREE_COST,
  toTestConfig,
  aggregateResults,
  aggregateResultsDetailed,
} from '../compareHelpers';
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_CLOUD_PRESETS,
  profileToDropdownValue,
  isOllamaCloudValue,
  getOllamaPreset,
} from '../OllamaCloudPresets';

function row(over: Partial<LabArenaResult> = {}): LabArenaResult {
  return {
    id: 'r1',
    runId: 'run1',
    versionId: null,
    versionNumber: null,
    scenarioName: 'scenario-a',
    modelId: 'haiku',
    provider: 'anthropic',
    status: 'completed',
    outputPreview: 'out',
    toolAccuracyScore: 80,
    outputQualityScore: 90,
    protocolCompliance: 70,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    durationMs: 2000,
    rationale: null,
    suggestions: null,
    errorMessage: null,
    evalMethod: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('aggregateResultsDetailed', () => {
  it('distinguishes an unstarted run from a model that produced nothing', () => {
    expect(aggregateResultsDetailed([], 'haiku')).toEqual({ status: 'empty' });
    expect(aggregateResultsDetailed([row({ modelId: 'sonnet' })], 'haiku')).toEqual({
      status: 'missing',
      modelId: 'haiku',
    });
  });

  it('reports ok with metrics when the model has rows', () => {
    const out = aggregateResultsDetailed([row()], 'haiku');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.metrics.count).toBe(1);
    expect(out.metrics.provider).toBe('anthropic');
  });
});

describe('aggregateResults', () => {
  it('returns null when no row matches the model', () => {
    expect(aggregateResults([row({ modelId: 'sonnet' })], 'haiku')).toBeNull();
  });

  it('sums cost and tokens and averages durations across rows', () => {
    const metrics = aggregateResults(
      [row(), row({ id: 'r2', costUsd: 0.03, durationMs: 4000, inputTokens: 20, outputTokens: 10 })],
      'haiku',
    );
    expect(metrics).not.toBeNull();
    expect(metrics!.count).toBe(2);
    expect(metrics!.totalCost).toBeCloseTo(0.04, 10);
    expect(metrics!.totalInputTokens).toBe(120);
    expect(metrics!.totalOutputTokens).toBe(60);
    expect(metrics!.avgDuration).toBe(3000);
  });
});

describe('ALL_COMPARE_MODELS', () => {
  it('has unique ids and carries every Ollama preset', () => {
    const ids = ALL_COMPARE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of OLLAMA_CLOUD_PRESETS) {
      const opt = ALL_COMPARE_MODELS.find((m) => m.id === preset.value);
      expect(opt, `missing compare option for preset ${preset.value}`).toBeDefined();
      expect(opt!.model).toBe(preset.modelId);
      expect(opt!.base_url).toBe(OLLAMA_CLOUD_BASE_URL);
    }
  });

  // The priced options showed `~$0.25/1K` / `~$3/1K` / `~$15/1K` until
  // 2026-08-28. Anthropic publishes per MILLION tokens, so a `/1K`
  // denominator overstates by 1000x, and a single figure hides the output
  // rate entirely. Both shapes are re-introducible by a one-word edit, so
  // both are asserted against here rather than left to review.
  it('quotes every priced model as an input/output pair, never per-1K', () => {
    const priced = ALL_COMPARE_MODELS.filter((m) => m.cost !== FREE_COST);
    expect(priced.length).toBeGreaterThan(0);
    for (const m of priced) {
      expect(m.cost, `${m.id} must not quote a per-1K price`).not.toMatch(/\/\s*1K/i);
      expect(m.cost, `${m.id} must quote input/output as $in/$out`).toMatch(
        /^\$\d+(\.\d+)?\/\$\d+(\.\d+)?$/,
      );
    }
  });

  it('maps an option onto a test config without inventing fields', () => {
    const opt = ALL_COMPARE_MODELS.find((m) => m.id === 'sonnet')!;
    expect(toTestConfig(opt)).toEqual({
      id: 'sonnet',
      provider: 'anthropic',
      model: 'sonnet',
      base_url: undefined,
    });
  });
});

describe('OllamaCloudPresets', () => {
  it('round-trips every preset through the dropdown value', () => {
    for (const preset of OLLAMA_CLOUD_PRESETS) {
      expect(isOllamaCloudValue(preset.value)).toBe(true);
      expect(getOllamaPreset(preset.value)).toEqual(preset);
      expect(
        profileToDropdownValue({
          provider: 'ollama',
          model: preset.modelId,
          base_url: OLLAMA_CLOUD_BASE_URL,
        }),
      ).toBe(preset.value);
    }
  });

  it('maps the Anthropic tiers and falls back to custom', () => {
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'haiku' })).toBe('haiku');
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'sonnet' })).toBe('sonnet');
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'opus' })).toBe('opus');
    expect(profileToDropdownValue({ provider: 'litellm', model: 'gpt-4o' })).toBe('custom');
    // A self-hosted Ollama endpoint is NOT one of the cloud presets.
    expect(
      profileToDropdownValue({ provider: 'ollama', model: 'llama3.1:8b', base_url: 'http://localhost:11434' }),
    ).toBe('custom');
  });
});
