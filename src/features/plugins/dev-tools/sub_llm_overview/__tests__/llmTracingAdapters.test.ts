import { describe, it, expect } from 'vitest';
import {
  foldByUseCase,
  windowSince,
  inferProvider,
  fetchPaged,
  mapLangfuseObservations,
  mapLangSmithRuns,
  mapHeliconeRequests,
  isOverBudget,
  overBudgetCount,
  pinpointsForContext,
  type LlmPinpoint,
} from '../llmTracingAdapters';
import { LLM_COST_THRESHOLD_USD } from '../../sub_triage/findings/findingConfig';
import { emitLlmCostFindings } from '../../sub_triage/findings/emitters';
import { contextCostFromSpend } from '../../sub_context/useContextRuntime';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';

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

describe('inferProvider', () => {
  it('maps common model families, else unknown', () => {
    expect(inferProvider('claude-sonnet-4-5')).toBe('anthropic');
    expect(inferProvider('gpt-4o-mini')).toBe('openai');
    expect(inferProvider('o3-mini')).toBe('openai');
    expect(inferProvider('gemini-2.5-pro')).toBe('google');
    expect(inferProvider('mistral-large')).toBe('mistral');
    expect(inferProvider('llama-3.1-70b')).toBe('meta');
    expect(inferProvider('')).toBe('unknown');
    expect(inferProvider(null)).toBe('unknown');
    expect(inferProvider('acme-model-9')).toBe('unknown');
  });
});

describe('mapLangfuseObservations', () => {
  const since = '2026-07-01T00:00:00.000Z';
  it('maps observations, infers provider, filters by window, sums cost fallback', () => {
    const body = {
      data: [
        { name: 'summarize', providedModelName: 'claude-sonnet-4-5', inputUsage: 1000, outputUsage: 200, totalCost: 0.01, startTime: '2026-07-05T00:00:00Z' },
        { name: 'classify', providedModelName: 'gpt-4o-mini', inputUsage: 100, outputUsage: 10, inputCost: 0.0001, outputCost: 0.0002, startTime: '2026-07-06T00:00:00Z' },
        { name: 'old', providedModelName: 'gpt-4o', inputUsage: 5, outputUsage: 5, totalCost: 9, startTime: '2026-06-01T00:00:00Z' },
      ],
    };
    const rows = mapLangfuseObservations(body, since);
    expect(rows).toHaveLength(2); // the June obs is before `since`
    const s = rows.find((r) => r.useCaseName === 'summarize')!;
    expect(s.provider).toBe('anthropic');
    expect(s.model).toBe('claude-sonnet-4-5');
    expect(s.inputTokens).toBe(1000);
    expect(s.totalCostUsd).toBeCloseTo(0.01);
    const c = rows.find((r) => r.useCaseName === 'classify')!;
    expect(c.provider).toBe('openai');
    expect(c.totalCostUsd).toBeCloseTo(0.0003); // input+output cost fallback (no totalCost)
  });
  it('tolerates a non-array / missing body', () => {
    expect(mapLangfuseObservations({}, since)).toEqual([]);
    expect(mapLangfuseObservations(null, since)).toEqual([]);
  });
});

describe('mapLangSmithRuns', () => {
  const since = '2026-07-01T00:00:00.000Z';
  it('reads ls_model_name / ls_provider, parses string cost, falls back when absent', () => {
    const body = {
      runs: [
        { name: 'draft-reply', prompt_tokens: 300, completion_tokens: 80, total_cost: '0.004', start_time: '2026-07-05T00:00:00Z', extra: { metadata: { ls_model_name: 'gpt-4o', ls_provider: 'OpenAI' } } },
        { name: 'no-meta', prompt_tokens: 10, completion_tokens: 2, start_time: '2026-07-05T00:00:00Z' },
      ],
    };
    const rows = mapLangSmithRuns(body, since);
    expect(rows).toHaveLength(2);
    const d = rows.find((r) => r.useCaseName === 'draft-reply')!;
    expect(d.model).toBe('gpt-4o');
    expect(d.provider).toBe('openai'); // lowercased from "OpenAI"
    expect(d.inputTokens).toBe(300);
    expect(d.totalCostUsd).toBeCloseTo(0.004);
    const n = rows.find((r) => r.useCaseName === 'no-meta')!;
    expect(n.model).toBe('unknown');
    expect(n.provider).toBe('unknown');
  });
});

describe('mapHeliconeRequests', () => {
  const since = '2026-07-01T00:00:00.000Z';
  it('uses request_path as name, provider directly (lowercased)', () => {
    const rows = mapHeliconeRequests(
      {
        data: [
          { request_path: 'POST /v1/chat', request_model: 'claude-haiku', provider: 'ANTHROPIC', prompt_tokens: 50, completion_tokens: 20, costUSD: 0.0005, request_created_at: '2026-07-05T00:00:00Z' },
        ],
      },
      since,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.useCaseName).toBe('POST /v1/chat');
    expect(rows[0]!.provider).toBe('anthropic');
    expect(rows[0]!.model).toBe('claude-haiku');
    expect(rows[0]!.totalCostUsd).toBeCloseTo(0.0005);
  });
  it('accepts a bare array body', () => {
    const rows = mapHeliconeRequests(
      [{ request_path: 'x', request_model: 'gpt-4o', provider: 'openai', prompt_tokens: 1, completion_tokens: 1, costUSD: 0, request_created_at: '2026-07-05T00:00:00Z' }],
      since,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('openai');
  });
});

describe('fetchPaged', () => {
  const pp = (name: string): LlmPinpoint => ({
    useCaseName: name,
    provider: 'x',
    model: 'm',
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    costIsEstimate: true,
  });

  it('concatenates pages until next is null', async () => {
    const pages: Array<{ items: LlmPinpoint[]; next: number | null }> = [
      { items: [pp('a')], next: 1 },
      { items: [pp('b')], next: 2 },
      { items: [pp('c')], next: null },
    ];
    let i = 0;
    const out = await fetchPaged<number>(async () => pages[i++]!);
    expect(out.rows.map((r) => r.useCaseName)).toEqual(['a', 'b', 'c']);
    expect(out.truncated).toBe(false);
  });

  it('stops at the page cap even if next never nulls', async () => {
    const out = await fetchPaged<number>(async (c) => ({ items: [pp(`p${c ?? 0}`)], next: (c ?? 0) + 1 }));
    expect(out.rows).toHaveLength(5); // MAX_PAGES
  });

  it('stops on an empty page (paged past the window)', async () => {
    let i = 0;
    const out = await fetchPaged<number>(async () =>
      i++ === 0 ? { items: [pp('a')], next: 1 } : { items: [], next: 2 },
    );
    expect(out.rows.map((r) => r.useCaseName)).toEqual(['a']);
    expect(out.truncated).toBe(false);
  });

  /* Sweep #381 — the cap used to be silent, so a high-volume project's 30d
     spend rendered as the bill when it was only its first 1000 calls. */
  it('flags truncation when the cap bites with the tool still offering more', async () => {
    const out = await fetchPaged<number>(async (c) => ({ items: [pp(`p${c ?? 0}`)], next: (c ?? 0) + 1 }));
    expect(out.truncated).toBe(true);
  });

  it('does not flag a short window that finished inside the cap', async () => {
    const out = await fetchPaged<number>(async () => ({ items: [pp('a')], next: null }));
    expect(out.rows).toHaveLength(1);
    expect(out.truncated).toBe(false);
  });

  it('does not flag a walk that used every page and then ran out', async () => {
    let i = 0;
    const out = await fetchPaged<number>(async () => {
      i += 1;
      return { items: [pp(`p${i}`)], next: i < 5 ? i : null };
    });
    expect(out.rows).toHaveLength(5);
    expect(out.truncated).toBe(false);
  });
});

/**
 * The severity rule the overview table and the findings sweep now share. The
 * assertion that matters is the LAST one: the chip count and
 * `emitLlmCostFindings` must return the same number for the same rows, because
 * a table that disagrees with the sweep about "expensive" is the defect this
 * predicate was extracted to end.
 */
describe('over-budget predicate', () => {
  function row(over: Partial<LlmPinpoint>): LlmPinpoint {
    return {
      useCaseName: 'a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      calls: 3,
      inputTokens: 100,
      outputTokens: 50,
      totalCostUsd: 0,
      costIsEstimate: true,
      ...over,
    };
  }

  const fixture: LlmPinpoint[] = [
    row({ useCaseName: 'expensive', totalCostUsd: 12 }),
    row({ useCaseName: 'cheap', totalCostUsd: 1.2 }),
    row({ useCaseName: 'at-threshold', totalCostUsd: LLM_COST_THRESHOLD_USD }),
    // An unnamed rollup has no call site to investigate, so the sweep skips it
    // however expensive it is. The chip must skip it too.
    row({ useCaseName: null, totalCostUsd: 40 }),
  ];

  it('flags only named rows strictly above the threshold', () => {
    expect(fixture.map(isOverBudget)).toEqual([true, false, false, false]);
    expect(overBudgetCount(fixture)).toBe(1);
  });

  it('counts exactly what the findings sweep would raise', () => {
    const drafts = emitLlmCostFindings(fixture, '30d', new Map());
    const costDrafts = drafts.filter((d) => d.origin === 'llm_cost');
    expect(overBudgetCount(fixture)).toBe(costDrafts.length);
    expect(costDrafts[0]?.evidence.thresholdUsd).toBe(LLM_COST_THRESHOLD_USD);
  });
});

/**
 * The Context Map cost chip and the table it now opens must count the same
 * rows. `contextCostFromSpend` attributes spend through `use case → context_ids`;
 * `pinpointsForContext` walks the SAME edge. This test drives both from one
 * fixture so a change to either without the other goes red.
 */
describe('cost chip and its destination share one predicate', () => {
  function row(name: string | null, cost: number): LlmPinpoint {
    return {
      useCaseName: name,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      calls: 2,
      inputTokens: 10,
      outputTokens: 5,
      totalCostUsd: cost,
      costIsEstimate: true,
    };
  }

  const useCases = [
    { slug: 'draft-reply', context_ids: ['ctx-a', 'ctx-b'] },
    { slug: 'summarize-thread', context_ids: ['ctx-b'] },
    { slug: 'rank-leads', context_ids: ['ctx-c'] },
  ] as unknown as DevUseCase[];

  const contextsBySlug = new Map(useCases.map((u) => [u.slug, u.context_ids]));

  const pinpoints = [
    row('Draft reply', 3),
    row('Summarize thread', 1.5),
    row('Rank leads', 9),
    // Uninstrumented: it contributed to no context's figure, so it must not
    // show up under any context's filter either.
    row(null, 40),
  ];

  const costBySlug = new Map([
    ['draft-reply', 3],
    ['summarize-thread', 1.5],
    ['rank-leads', 9],
  ]);

  it('the filtered row set is exactly the use cases the chip counted', () => {
    const byContext = contextCostFromSpend(costBySlug, useCases);

    // ctx-a: only draft-reply.
    const a = pinpointsForContext(pinpoints, contextsBySlug, 'ctx-a');
    expect(a.map((p) => p.useCaseName)).toEqual(['Draft reply']);
    expect(a.reduce((s, p) => s + p.totalCostUsd, 0)).toBe(byContext.get('ctx-a'));

    // ctx-b: draft-reply AND summarize-thread — the chip's figure is their sum.
    const b = pinpointsForContext(pinpoints, contextsBySlug, 'ctx-b');
    expect(b.map((p) => p.useCaseName)).toEqual(['Draft reply', 'Summarize thread']);
    expect(b.reduce((s, p) => s + p.totalCostUsd, 0)).toBe(byContext.get('ctx-b'));
  });

  it('a context nothing slices filters to empty, not to everything', () => {
    expect(pinpointsForContext(pinpoints, contextsBySlug, 'ctx-nobody')).toEqual([]);
  });

  it('an unnamed rollup belongs to no context filter however expensive', () => {
    for (const ctx of ['ctx-a', 'ctx-b', 'ctx-c']) {
      expect(pinpointsForContext(pinpoints, contextsBySlug, ctx).some((p) => p.useCaseName === null)).toBe(false);
    }
  });
});
