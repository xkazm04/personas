import { describe, it, expect } from 'vitest';
import { foldByUseCase, windowSince, type LlmPinpoint } from '../llmTracingAdapters';

function pp(over: Partial<LlmPinpoint>): LlmPinpoint {
  return {
    useCaseName: null,
    provider: 'anthropic',
    model: 'claude-haiku',
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    totalCostUsd: 0.001,
    costIsEstimate: true,
    ...over,
  };
}

describe('foldByUseCase', () => {
  it('collapses a named use-case across models to its default (modal) model with summed usage', () => {
    const rows = [
      pp({ useCaseName: 'summarize', model: 'claude-haiku', calls: 10, inputTokens: 100, totalCostUsd: 1 }),
      pp({ useCaseName: 'summarize', model: 'claude-opus', calls: 3, inputTokens: 30, totalCostUsd: 2 }),
    ];
    const folded = foldByUseCase(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0]!.useCaseName).toBe('summarize');
    expect(folded[0]!.model).toBe('claude-haiku'); // modal model (10 > 3 calls)
    expect(folded[0]!.calls).toBe(13);
    expect(folded[0]!.inputTokens).toBe(130);
    expect(folded[0]!.totalCostUsd).toBeCloseTo(3);
  });

  it('keeps un-named calls as one row per model (the model-fallback bucket)', () => {
    const rows = [
      pp({ useCaseName: null, model: 'gpt-4o', calls: 5 }),
      pp({ useCaseName: null, model: 'gpt-4o-mini', calls: 8 }),
    ];
    const folded = foldByUseCase(rows);
    expect(folded).toHaveLength(2);
    expect(folded.every((r) => r.useCaseName === null)).toBe(true);
    expect(folded.map((r) => r.model).sort()).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('does not collide a literal use-case named "model:x" with the fallback bucket', () => {
    const rows = [
      pp({ useCaseName: 'model:claude-haiku', model: 'claude-haiku', calls: 2 }),
      pp({ useCaseName: null, model: 'claude-haiku', calls: 4 }),
    ];
    const folded = foldByUseCase(rows);
    expect(folded).toHaveLength(2); // the named one and the unnamed bucket stay distinct
  });

  it('sorts most-expensive first', () => {
    const rows = [
      pp({ useCaseName: 'cheap', totalCostUsd: 0.1 }),
      pp({ useCaseName: 'pricey', totalCostUsd: 9 }),
    ];
    expect(foldByUseCase(rows).map((r) => r.useCaseName)).toEqual(['pricey', 'cheap']);
  });
});

describe('windowSince', () => {
  it('computes the window start relative to now', () => {
    const now = Date.UTC(2026, 6, 8, 12, 0, 0);
    const day = 86_400_000;
    expect(windowSince('24h', now)).toBe(new Date(now - day).toISOString());
    expect(windowSince('7d', now)).toBe(new Date(now - 7 * day).toISOString());
    expect(windowSince('30d', now)).toBe(new Date(now - 30 * day).toISOString());
  });
});
