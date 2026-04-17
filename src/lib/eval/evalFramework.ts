/**
 * Unified evaluation framework for persona testing.
 *
 * Provides a single source of truth for scoring weights, composite calculation,
 * score visualization, and status badge styling -- replacing the duplicated
 * logic that was spread across testUtils.ts, labUtils.ts, and test_runner.rs.
 *
 * The Rust backend (`engine/eval.rs`) owns the authoritative evaluation logic;
 * this module provides the frontend counterpart for display and re-computation.
 */

import type { EvalStrategyKind } from '@/lib/bindings/EvalStrategyKind';
import { en, type Translations } from '@/i18n/en';

// Re-export for convenience
export type { EvalStrategyKind };

// -- Standardized EvalResult (mirrors Rust EvalResult) ---------

export interface EvalResult {
  strategy: EvalStrategyKind;
  /** Score from 0--100. Higher is better. */
  score: number;
  /** Confidence in the score (0.0--1.0). */
  confidence: number;
  /** Human-readable explanation of how the score was derived. */
  explanation: string;
  /** Whether this evaluation indicates a pass or fail. */
  passed?: boolean;
}

export interface CompositeEvalResult {
  composite: EvalResult;
  individual: EvalResult[];
}

// -- Scoring weights (single source of truth) ------------------
// Keep in sync with WEIGHT_* in src-tauri/src/engine/eval.rs

export const WEIGHT_TOOL_ACCURACY = 0.4;
export const WEIGHT_OUTPUT_QUALITY = 0.4;
export const WEIGHT_PROTOCOL_COMPLIANCE = 0.2;

/** Compute the weighted composite score from individual metric scores. */
export function compositeScore(
  toolAccuracy: number,
  outputQuality: number,
  protocolCompliance: number,
): number {
  return Math.round(
    toolAccuracy * WEIGHT_TOOL_ACCURACY
    + outputQuality * WEIGHT_OUTPUT_QUALITY
    + protocolCompliance * WEIGHT_PROTOCOL_COMPLIANCE,
  );
}

// -- Score visualization ----------------------------------------

/** Return Tailwind color class for a score value. */
export function scoreColor(score: number | null): string {
  if (score === null) return 'text-foreground';
  if (score >= 80) return 'text-status-success';
  if (score >= 50) return 'text-status-warning';
  return 'text-status-error';
}

// -- Status badge styling ---------------------------------------

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  drafting:   { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30' },
  generating: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  running:    { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  completed:  { bg: 'bg-status-success/15', text: 'text-status-success', border: 'border-status-success/20' },
  passed:     { bg: 'bg-status-success/15', text: 'text-status-success', border: 'border-status-success/20' },
  failed:     { bg: 'bg-status-error/15', text: 'text-status-error', border: 'border-status-error/20' },
  cancelled:  { bg: 'bg-status-warning/15', text: 'text-status-warning', border: 'border-status-warning/20' },
  error:      { bg: 'bg-status-warning/15', text: 'text-status-warning', border: 'border-status-warning/20' },
};

const FALLBACK_STATUS = { bg: 'bg-status-warning/15', text: 'text-status-warning', border: 'border-status-warning/20' };

/** Return Tailwind class string for a status badge. */
export function statusBadge(status: string): string {
  const c = STATUS_STYLES[status] ?? FALLBACK_STATUS;
  return `px-2 py-0.5 rounded-lg text-sm font-medium border ${c.bg} ${c.text} ${c.border}`;
}

// -- Strategy metadata ------------------------------------------

interface StrategyMeta {
  label: string;
  description: string;
  weight: number | null;
}

/** i18n keys for each strategy's label and description. */
const STRATEGY_KEYS: Record<EvalStrategyKind, { labelKey: keyof Translations['eval_strategies']; descKey: keyof Translations['eval_strategies']; weight: number | null }> = {
  keyword_match:        { labelKey: 'keyword_match_label',        descKey: 'keyword_match_description',        weight: WEIGHT_OUTPUT_QUALITY },
  tool_accuracy:        { labelKey: 'tool_accuracy_label',        descKey: 'tool_accuracy_description',        weight: WEIGHT_TOOL_ACCURACY },
  protocol_compliance:  { labelKey: 'protocol_compliance_label',  descKey: 'protocol_compliance_description',  weight: WEIGHT_PROTOCOL_COMPLIANCE },
  confusion_detect:     { labelKey: 'confusion_detect_label',     descKey: 'confusion_detect_description',     weight: null },
  composite:            { labelKey: 'composite_label',            descKey: 'composite_description',            weight: null },
};

/** Resolve STRATEGY_META from the given translation bundle (defaults to English). */
export function getStrategyMeta(t: Translations = en): Record<EvalStrategyKind, StrategyMeta> {
  const result = {} as Record<EvalStrategyKind, StrategyMeta>;
  for (const [kind, keys] of Object.entries(STRATEGY_KEYS) as [EvalStrategyKind, typeof STRATEGY_KEYS[EvalStrategyKind]][]) {
    result[kind] = {
      label: t.eval_strategies[keys.labelKey] as string,
      description: t.eval_strategies[keys.descKey] as string,
      weight: keys.weight,
    };
  }
  return result;
}

/** Pre-resolved English STRATEGY_META for backward-compatible direct access. */
export const STRATEGY_META: Record<EvalStrategyKind, StrategyMeta> = getStrategyMeta(en);
