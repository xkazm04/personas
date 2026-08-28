import type { ModelTestConfig } from '@/api/agents/tests';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScore } from '@/lib/eval/evalFramework';
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

export const ALL_COMPARE_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku', group: 'Anthropic', cost: '$1/$5' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet', group: 'Anthropic', cost: '$3/$15' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus', group: 'Anthropic', cost: '$5/$25' },
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

export interface ModelMetrics {
  modelId: string;
  provider: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  composite: number;
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

function computeMetrics(rows: LabArenaResult[], modelId: string): ModelMetrics {
  const n = rows.length;
  const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
  const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
  const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
  return {
    modelId,
    provider: rows[0]?.provider ?? 'unknown',
    avgToolAccuracy: Math.round(avgTA),
    avgOutputQuality: Math.round(avgOQ),
    avgProtocolCompliance: Math.round(avgPC),
    composite: compositeScore(avgTA, avgOQ, avgPC),
    totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
    avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n),
    totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    count: n,
  };
}
