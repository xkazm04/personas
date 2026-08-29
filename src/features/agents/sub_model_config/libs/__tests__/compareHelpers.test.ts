import { describe, it, expect } from 'vitest';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import {
  ALL_COMPARE_MODELS,
  ANTHROPIC_TIERS,
  FREE_COST,
  costBucket,
  buildModelSelectEvent,
  buildCompareStartEvent,
  buildCompareOutcomeEvent,
  toTestConfig,
  aggregateResults,
  aggregateResultsDetailed,
  rowFailure,
} from '../compareHelpers';
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_CLOUD_PRESETS,
  profileToDropdownValue,
  isOllamaCloudValue,
  getOllamaPreset,
  UNSET_MODEL_VALUE,
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

describe('model-config telemetry events', () => {
  const metrics = (modelId: string, composite: number | null, totalCost: number) => ({
    modelId,
    provider: 'anthropic',
    avgToolAccuracy: 0,
    avgOutputQuality: 0,
    avgProtocolCompliance: 0,
    composite,
    scored: { toolAccuracy: 1, outputQuality: 1, protocolCompliance: 1 },
    totalCost,
    avgDuration: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    count: 1,
  });

  it('buckets spend into ordered bands and never leaves a finite figure unbucketed', () => {
    expect(costBucket(0)).toBe('zero');
    expect(costBucket(-1)).toBe('zero');
    expect(costBucket(Number.NaN)).toBe('zero');
    expect(costBucket(0.005)).toBe('lt_0_01');
    expect(costBucket(0.05)).toBe('lt_0_10');
    expect(costBucket(0.5)).toBe('lt_1');
    expect(costBucket(12)).toBe('gte_1');
  });

  it('names the model choice and the compared pair', () => {
    expect(buildModelSelectEvent('opus')).toEqual({
      category: 'model_config',
      action: 'model_select',
      label: 'opus',
    });
    expect(buildCompareStartEvent('haiku', 'sonnet').label).toBe('haiku_vs_sonnet');
  });

  it('carries the outcome the panel used to discard — winner and a spend band, never a raw figure', () => {
    const won = buildCompareOutcomeEvent(metrics('haiku', 40, 0.02), metrics('sonnet', 80, 0.03), 'haiku', 'sonnet');
    expect(won.action).toBe('compare_complete');
    expect(won.label).toBe('haiku_vs_sonnet|winner=sonnet|cost=lt_0_10');
    // The exact dollar figure must not survive into the event.
    expect(won.label).not.toContain('0.05');

    const tied = buildCompareOutcomeEvent(metrics('haiku', 70, 0), metrics('opus', 70, 0), 'haiku', 'opus');
    expect(tied.label).toBe('haiku_vs_opus|winner=tie|cost=zero');

    // An unscored model must never be reported as the loser — that is a
    // verdict on evidence that does not exist.
    const unscored = buildCompareOutcomeEvent(metrics('haiku', 70, 0), metrics('opus', null, 0), 'haiku', 'opus');
    expect(unscored.label).toBe('haiku_vs_opus|winner=unscored|cost=zero');
  });

  it('reports a run where a model produced nothing, instead of emitting no outcome at all', () => {
    const ok = metrics('haiku', 70, 0.5);

    // Model B never came back. Before, this emitted NOTHING — a compare_start
    // with no completion, indistinguishable from the user closing the panel.
    const oneSide = buildCompareOutcomeEvent(ok, null, 'haiku', 'sonnet');
    expect(oneSide.action).toBe('compare_complete');
    // A half-priced comparison has no cost figure: unknown stays unknown, never lt_1.
    expect(oneSide.label).toBe('haiku_vs_sonnet|winner=failed|cost=unknown|missing=sonnet');

    // Neither side reported: still exactly one outcome, and it names both.
    const neither = buildCompareOutcomeEvent(null, null, 'haiku', 'opus');
    expect(neither.label).toBe('haiku_vs_opus|winner=failed|cost=unknown|missing=haiku,opus');

    // `failed` outranks `unscored`: with no rows there is no composite to
    // have an opinion about, so the absence is reported as the absence.
    expect(buildCompareOutcomeEvent(null, metrics('opus', null, 0), 'haiku', 'opus').label)
      .toContain('winner=failed');

    // A complete run must not pick up the failure suffix.
    expect(buildCompareOutcomeEvent(ok, metrics('opus', 90, 0), 'haiku', 'opus').label)
      .not.toContain('missing=');
  });
});

describe('computeMetrics null-awareness', () => {
  it('averages only the rows that carried a score, and counts the admissions', () => {
    const metrics = aggregateResults(
      [
        row({ toolAccuracyScore: 90 }),
        row({ id: 'r2', toolAccuracyScore: null }),
        row({ id: 'r3', toolAccuracyScore: null }),
      ],
      'haiku',
    )!;
    // 90 over the ONE row that was graded — not 30 (90/3), which is what
    // `?? 0` produced until 2026-08-28.
    expect(metrics.avgToolAccuracy).toBe(90);
    expect(metrics.scored.toolAccuracy).toBe(1);
    expect(metrics.count).toBe(3);
  });

  it('reports an entirely ungraded dimension as null, never as zero', () => {
    const metrics = aggregateResults(
      [row({ toolAccuracyScore: null }), row({ id: 'r2', toolAccuracyScore: null })],
      'haiku',
    )!;
    expect(metrics.avgToolAccuracy).toBeNull();
    expect(metrics.scored.toolAccuracy).toBe(0);
    // The remaining dimensions still carry the composite.
    expect(metrics.composite).not.toBeNull();
  });

  it('has no composite at all when not one dimension was graded', () => {
    const metrics = aggregateResults(
      [row({ toolAccuracyScore: null, outputQualityScore: null, protocolCompliance: null })],
      'haiku',
    )!;
    expect(metrics.composite).toBeNull();
  });

  it('does not let an ungraded dimension drag a model below a fully graded rival', () => {
    // Both models score 80 on everything they were graded on; B simply was not
    // graded on tool accuracy. B must not lose for it.
    const a = aggregateResults([row({ modelId: 'a', toolAccuracyScore: 80, outputQualityScore: 80, protocolCompliance: 80 })], 'a')!;
    const b = aggregateResults([row({ modelId: 'b', toolAccuracyScore: null, outputQualityScore: 80, protocolCompliance: 80 })], 'b')!;
    expect(b.composite).toBe(a.composite);
  });
});

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

  // ModelSelector kept its own hand-typed copy of the three tiers and their
  // prices until 2026-08-28, so a price correction could land in the chooser
  // and leave the A/B dropdown quoting the old figure. Both lists now derive
  // from ANTHROPIC_TIERS; this asserts the derivation stays exact.
  it('derives every Anthropic option from the single tier list', () => {
    const anthropic = ALL_COMPARE_MODELS.filter((m) => m.provider === 'anthropic');
    expect(anthropic.map((m) => ({ value: m.id, label: m.label, cost: m.cost }))).toEqual(
      ANTHROPIC_TIERS.map((tier) => ({ value: tier.value, label: tier.label, cost: tier.cost })),
    );
    // The dropdown value IS the model id sent to the API.
    for (const m of anthropic) expect(m.model).toBe(m.id);
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

  // This returned 'opus' for a persona with no model profile until
  // 2026-08-28, painting the priciest tier as an explicit choice the user
  // never made.
  it('reports a persona with no model as unset, not as a choice of the priciest tier', () => {
    expect(profileToDropdownValue({})).toBe(UNSET_MODEL_VALUE);
    expect(profileToDropdownValue({ provider: 'anthropic' })).toBe(UNSET_MODEL_VALUE);
    expect(UNSET_MODEL_VALUE).toBe('');
    // No selector row can match the unset value — nothing paints as selected.
    expect(ALL_COMPARE_MODELS.some((m) => m.id === UNSET_MODEL_VALUE)).toBe(false);
    // An explicit Opus choice is still Opus, and is distinguishable from it.
    expect(profileToDropdownValue({ provider: 'anthropic', model: 'opus' })).not.toBe(
      UNSET_MODEL_VALUE,
    );
  });
});

// Until 2026-08-29 nothing in the compare lane read `status` or `errorMessage`
// at the row level: an errored cell rendered a score dash, a 0.0s duration and
// — because the runner copies the error string into `output_preview` — the
// error text inside the model's output box, styled as something the model said.
describe('rowFailure — a cell that never ran vs one that ran badly', () => {
  it('reports error and cancelled rows as failures, carrying the reason', () => {
    expect(rowFailure(row({ status: 'error', errorMessage: 'timeout after 120s' }))).toEqual({
      status: 'error',
      message: 'timeout after 120s',
    });
    expect(rowFailure(row({ status: 'cancelled', errorMessage: 'Cancelled' }))).toEqual({
      status: 'cancelled',
      message: 'Cancelled',
    });
  });

  it('reports a null message rather than inventing one, so the caller can translate a fallback', () => {
    expect(rowFailure(row({ status: 'error', errorMessage: null }))).toEqual({
      status: 'error',
      message: null,
    });
  });

  // `failed` is the runner's word for "scored below the pass threshold"
  // (verdict_status, scoring.rs) — a measurement the panel already renders.
  // Treating it as a run failure would hide every low score behind an error
  // badge, which is the opposite regression.
  it('does NOT treat a low-scoring or inconclusive row as a failure to run', () => {
    expect(rowFailure(row({ status: 'failed' }))).toBeNull();
    expect(rowFailure(row({ status: 'passed' }))).toBeNull();
    expect(rowFailure(row({ status: 'inconclusive' }))).toBeNull();
  });

  it('is null for an absent row, so a missing cell stays a missing cell', () => {
    expect(rowFailure(undefined)).toBeNull();
    expect(rowFailure(null)).toBeNull();
  });

  // The discriminator this panel's evaluation reached for first. No row the
  // runner writes ever has status 'completed', so `status !== 'completed'`
  // would flag every row — including the successes — as a failure.
  it('is not satisfied by the status !== completed test', () => {
    const passed = row({ status: 'passed' });
    expect(passed.status).not.toBe('completed');
    expect(rowFailure(passed)).toBeNull();
  });
});
