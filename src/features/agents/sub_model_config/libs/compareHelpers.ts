import type { ModelTestConfig } from '@/api/agents/tests';
import type { InteractionEvent } from '@/lib/analytics/sink';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScoreFromRow } from '@/lib/eval/evalFramework';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from './OllamaCloudPresets';

// -- Model options --

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
  group: string;
  cost: string;
}

/**
 * `cost` is an input/output pair in USD per MILLION tokens, rendered by
 * `ModelDropdown` with a translated "per 1M tokens" suffix. It is NOT per 1K —
 * these read `~$0.25/1K` / `~$3/1K` / `~$15/1K` until 2026-08-28, a denominator
 * that overstates by 1000x read literally and hides the 5x output rate read
 * charitably. `FREE_COST` marks the models that carry no per-token charge, and
 * suppresses the unit suffix at the render site.
 */
export const FREE_COST = 'Free';

/**
 * The Anthropic tiers and their prices, defined ONCE.
 *
 * The Ollama half of this context always derived both its selector rows and
 * its compare options from `OLLAMA_CLOUD_PRESETS`; the Anthropic half was
 * typed out a second time in `ModelSelector.tsx` until 2026-08-28, so a price
 * correction landed in one list and left the other stale — two call sites on
 * the same screen disagreeing about what a model costs. Add a tier here and
 * both the chooser and the A/B dropdown pick it up.
 */
export interface AnthropicTier {
  /** Dropdown value AND the model id sent to the API — they are the same. */
  value: string;
  label: string;
  cost: string;
}

export const ANTHROPIC_TIERS: readonly AnthropicTier[] = [
  { value: 'haiku', label: 'Haiku', cost: '$1/$5' },
  { value: 'sonnet', label: 'Sonnet', cost: '$3/$15' },
  { value: 'opus', label: 'Opus', cost: '$5/$25' },
];

export const ALL_COMPARE_MODELS: ModelOption[] = [
  ...ANTHROPIC_TIERS.map((tier) => ({
    id: tier.value,
    label: tier.label,
    provider: 'anthropic',
    model: tier.value,
    group: 'Anthropic',
    cost: tier.cost,
  })),
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
    group: 'Ollama',
    cost: FREE_COST,
  })),
];

export function toTestConfig(opt: ModelOption): ModelTestConfig {
  return { id: opt.id, provider: opt.provider, model: opt.model, base_url: opt.base_url };
}

// -- Metric helpers --

/**
 * How many of a model's rows actually carried each score. A dimension with a
 * `scored` of 0 was never measured — its average is `null`, not `0`.
 */
export interface ScoredCounts {
  toolAccuracy: number;
  outputQuality: number;
  protocolCompliance: number;
}

export interface ModelMetrics {
  modelId: string;
  provider: string;
  /**
   * Averages over the rows that CARRIED the score, or `null` when no row did.
   * These read `rows.reduce((s, r) => s + (r.x ?? 0), 0) / n` until 2026-08-28,
   * which folded "never graded" into the same figure as "graded zero": a model
   * whose rows were not graded on a dimension posted a real 0 on it, dragging
   * its composite down and handing the wins banner to the other model on
   * evidence that does not exist. A zero is a measurement; a null is an
   * admission, and `scored` carries the count of admissions alongside it.
   */
  avgToolAccuracy: number | null;
  avgOutputQuality: number | null;
  avgProtocolCompliance: number | null;
  /** Null when NOT ONE dimension was scored — there is no composite to state. */
  composite: number | null;
  /** Rows carrying each score, out of `count`. */
  scored: ScoredCounts;
  totalCost: number;
  avgDuration: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  count: number;
}

export function aggregateResults(results: LabArenaResult[], modelId: string): ModelMetrics | null {
  const rows = results.filter((r) => r.modelId === modelId);
  if (rows.length === 0) return null;
  return computeMetrics(rows, modelId);
}

/**
 * Outcome of aggregating results for one model.
 *  - `{ status: 'ok', metrics }`    — model produced at least one result.
 *  - `{ status: 'missing' }`        — model was expected (caller asked for
 *    it) but no rows in `results` have this modelId. Typically means the
 *    run for that model failed to complete or dispatch.
 *  - `{ status: 'empty' }`          — the whole `results` array is empty;
 *    caller hasn't kicked off any run yet.
 *
 * Callers should distinguish 'missing' from 'empty' so the UI can surface
 * "Model X produced no results — run may have failed" instead of a generic
 * "no data" message.
 */
export type AggregateResult =
  | { status: 'ok'; metrics: ModelMetrics }
  | { status: 'missing'; modelId: string }
  | { status: 'empty' };

export function aggregateResultsDetailed(
  results: LabArenaResult[],
  modelId: string,
): AggregateResult {
  if (results.length === 0) return { status: 'empty' };
  const rows = results.filter((r) => r.modelId === modelId);
  if (rows.length === 0) return { status: 'missing', modelId };
  return { status: 'ok', metrics: computeMetrics(rows, modelId) };
}

/**
 * Mean over the rows that carried the score, plus the count of those rows.
 * Rows with a `null` score are EXCLUDED from both numerator and denominator —
 * an ungraded row must not vote for zero.
 */
function avgScored(
  rows: LabArenaResult[],
  pick: (r: LabArenaResult) => number | null,
): { avg: number | null; scored: number } {
  let sum = 0;
  let scored = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v == null) continue;
    sum += v;
    scored += 1;
  }
  return scored === 0 ? { avg: null, scored: 0 } : { avg: sum / scored, scored };
}

function computeMetrics(rows: LabArenaResult[], modelId: string): ModelMetrics {
  const n = rows.length;
  const ta = avgScored(rows, (r) => r.toolAccuracyScore);
  const oq = avgScored(rows, (r) => r.outputQualityScore);
  const pc = avgScored(rows, (r) => r.protocolCompliance);
  return {
    modelId,
    provider: rows[0]?.provider ?? 'unknown',
    avgToolAccuracy: ta.avg == null ? null : Math.round(ta.avg),
    avgOutputQuality: oq.avg == null ? null : Math.round(oq.avg),
    avgProtocolCompliance: pc.avg == null ? null : Math.round(pc.avg),
    // Re-weights the dimensions that were actually measured instead of
    // biasing the composite toward zero; null only when none were.
    composite: compositeScoreFromRow(ta.avg, oq.avg, pc.avg),
    scored: {
      toolAccuracy: ta.scored,
      outputQuality: oq.scored,
      protocolCompliance: pc.scored,
    },
    totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
    avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n),
    totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    count: n,
  };
}

// -- Telemetry event shaping ------------------------------------------------
//
// The model chooser and the A/B panel are where an operator makes this app's
// LLM spend-shaping decisions, and until 2026-08-28 not one of them recorded
// anything: the compare run computed cost, tokens and durations, rendered
// them, then discarded them on the next operation. These builders are pure so
// the event SHAPE is testable without a sink, a store, or a rendered tree —
// the components only hand the result to `getAnalyticsSink().interaction()`.
//
// Privacy: the sink's contract is identifier strings only (see
// `lib/analytics/sink.ts`) — no persona content, no prompts, no credentials.
// Spend is therefore reported as a BUCKET rather than an exact figure: enough
// to answer "does the compare panel change what people run", not enough to
// reconstruct an account's billing.

export const MODEL_CONFIG_TELEMETRY_CATEGORY = 'model_config';

/** Coarse spend bands. Ordered, and total — every finite input lands in one. */
export function costBucket(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'zero';
  if (usd < 0.01) return 'lt_0_01';
  if (usd < 0.1) return 'lt_0_10';
  if (usd < 1) return 'lt_1';
  return 'gte_1';
}

/** The persona's model changed to `modelId` (a dropdown value, not a prompt). */
export function buildModelSelectEvent(modelId: string): InteractionEvent {
  return { category: MODEL_CONFIG_TELEMETRY_CATEGORY, action: 'model_select', label: modelId };
}

/** An A/B comparison was dispatched for these two options. */
export function buildCompareStartEvent(modelA: string, modelB: string): InteractionEvent {
  return {
    category: MODEL_CONFIG_TELEMETRY_CATEGORY,
    action: 'compare_start',
    label: `${modelA}_vs_${modelB}`,
  };
}

/**
 * An A/B comparison produced results for both models — the event carrying the
 * outcome the panel used to throw away. `winner` is decided on composite
 * score, the same number the results table ranks on.
 *
 * A model with no scored dimension has a `null` composite: it is reported as
 * `unscored`, never as a loss. Declaring a winner over an absent score is the
 * exact fold this event is meant to observe, not commit.
 */
export function buildCompareOutcomeEvent(a: ModelMetrics, b: ModelMetrics): InteractionEvent {
  const winner =
    a.composite == null || b.composite == null
      ? 'unscored'
      : a.composite === b.composite
        ? 'tie'
        : a.composite > b.composite
          ? a.modelId
          : b.modelId;
  return {
    category: MODEL_CONFIG_TELEMETRY_CATEGORY,
    action: 'compare_complete',
    label: `${a.modelId}_vs_${b.modelId}|winner=${winner}|cost=${costBucket(a.totalCost + b.totalCost)}`,
  };
}
