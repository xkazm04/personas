/**
 * Unified evaluation framework for persona testing.
 *
 * Provides a single source of truth for scoring weights, composite calculation,
 * score visualization, and status badge styling — replacing the duplicated
 * logic that was spread across testUtils.ts, labUtils.ts, and test_runner.rs.
 *
 * The Rust backend (`engine/eval.rs`) owns the authoritative evaluation logic;
 * this module provides the frontend counterpart for display and re-computation.
 */

import type { EvalStrategyKind } from '@/lib/bindings/EvalStrategyKind';

// Re-export for convenience
export type { EvalStrategyKind };

// ── Standardized EvalResult (mirrors Rust EvalResult) ─────────

export interface EvalResult {
  strategy: EvalStrategyKind;
  /** Score from 0–100. Higher is better. */
  score: number;
  /** Confidence in the score (0.0–1.0). */
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

// ── Scoring weights (single source of truth) ──────────────────
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

// ── Score visualization ────────────────────────────────────────

/** Return Tailwind color class for a score value. */
export function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground/80';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

// ── Status badge styling ───────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  drafting:   { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30' },
  generating: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  running:    { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  completed:  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  passed:     { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  failed:     { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
  cancelled:  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  error:      { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
};

const FALLBACK_STATUS = { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' };

/** Return Tailwind class string for a status badge. */
export function statusBadge(status: string): string {
  const c = STATUS_STYLES[status] ?? FALLBACK_STATUS;
  return `px-2 py-0.5 rounded-md text-sm font-medium border ${c.bg} ${c.text} ${c.border}`;
}

// ── Strategy metadata ──────────────────────────────────────────

interface StrategyMeta {
  label: string;
  description: string;
  weight: number | null;
}

export const STRATEGY_META: Record<EvalStrategyKind, StrategyMeta> = {
  keyword_match: {
    label: 'Output Quality',
    description: 'Checks expected behavior terms in agent output',
    weight: WEIGHT_OUTPUT_QUALITY,
  },
  tool_accuracy: {
    label: 'Tool Accuracy',
    description: 'Compares expected vs actual tool calls',
    weight: WEIGHT_TOOL_ACCURACY,
  },
  protocol_compliance: {
    label: 'Protocol Compliance',
    description: 'Checks for expected protocol message patterns',
    weight: WEIGHT_PROTOCOL_COMPLIANCE,
  },
  confusion_detect: {
    label: 'Confusion Detection',
    description: 'Checks for known confusion/failure phrases',
    weight: null,
  },
  composite: {
    label: 'Composite',
    description: 'Weighted combination of all strategies',
    weight: null,
  },
};
