// ---------------------------------------------------------------------------
// Unified Error Pipeline
//
// Combines the three error classification systems into a single pass:
//   1. errorTaxonomy  → ErrorCategory + severity + retryability + failover
//   2. errorRegistry  → user-facing message + suggestion (toasts)
//   3. errorExplanation → UI-specific guidance + severity + navigation action
//
// Consumers call `classifyErrorFull()` once and get a single ClassifiedError
// object instead of calling three independent classifiers on the same string.
// ---------------------------------------------------------------------------

import {
  classifyError,
  classifyUnknownError,
  defaultSeverity,
  isAutoFixable,
  isFailoverEligible,
  categoryLabel,
  type ErrorCategory,
  type ErrorSeverity as TaxonomySeverity,
} from '@/lib/errorTaxonomy';
import { resolveError, type FriendlyError } from './errorRegistry';
import { getErrorExplanation, type ErrorExplanation } from './errorExplanation';

// ---------------------------------------------------------------------------
// ClassifiedError — the unified output
// ---------------------------------------------------------------------------

export interface ClassifiedError {
  /** Raw error string that was classified. */
  raw: string;

  // ── From errorTaxonomy ──────────────────────────────────────────────
  /** Canonical error category (rate_limit, timeout, credential_error, etc.) */
  category: ErrorCategory;
  /** Human-readable label for the category. */
  categoryLabel: string;
  /** Default severity from the taxonomy (info → critical). */
  taxonomySeverity: TaxonomySeverity;
  /** Whether the healing engine can automatically retry this error. */
  autoFixable: boolean;
  /** Whether this error should trigger provider failover. */
  failoverEligible: boolean;

  // ── From errorRegistry ──────────────────────────────────────────────
  /** User-facing friendly message + recovery suggestion. */
  friendly: FriendlyError;

  // ── From errorExplanation ───────────────────────────────────────────
  /** UI-specific explanation with guidance and optional navigation action.
   *  `null` when no pattern matched (rare/unknown errors). */
  explanation: ErrorExplanation | null;
}

// ---------------------------------------------------------------------------
// Pipeline entry points
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Memoization — classify each distinct raw string at most once
//
// The funnel runs three regex/substring passes (taxonomy + registry +
// explanation). Hot callers re-classify the SAME string repeatedly: the toast
// renderer re-renders once a second for its elapsed-time label, and the
// toastCatch path classifies the string the renderer will classify again. A
// small bounded cache makes "classify once per error instance" literal —
// repeat calls (from either path) return the same object without re-running any
// matcher. `resolveError`'s own breadcrumb dedupe still fires on the first
// (uncached) call, so telemetry is unaffected.
// ---------------------------------------------------------------------------

const CLASSIFY_CACHE_MAX = 128;
const classifyCache = new Map<string, ClassifiedError>();

function memoizedClassify(raw: string, category: ErrorCategory): ClassifiedError {
  const cached = classifyCache.get(raw);
  if (cached) return cached;
  const result = buildClassifiedError(raw, category);
  // Simple bounded LRU-ish eviction: drop the oldest insertion when full.
  if (classifyCache.size >= CLASSIFY_CACHE_MAX) {
    const oldest = classifyCache.keys().next().value;
    if (oldest !== undefined) classifyCache.delete(oldest);
  }
  classifyCache.set(raw, result);
  return result;
}

/**
 * Classify a raw error string through all three layers in a single pass.
 *
 * This is the primary entry point. Prefer this over calling `classifyError`,
 * `resolveError`, or `getErrorExplanation` independently. Results are memoized
 * per raw string, so calling it from both the toast-creation path and the
 * toast renderer costs a single classification.
 */
export function classifyErrorFull(raw: string): ClassifiedError {
  const cached = classifyCache.get(raw);
  if (cached) return cached;
  return memoizedClassify(raw, classifyError(raw));
}

/**
 * Classify from an unknown value (Error object, string, Tauri error, etc.).
 * Uses structured `kind` from Tauri errors when available.
 */
export function classifyUnknownErrorFull(err: unknown): ClassifiedError {
  const raw = err instanceof Error ? err.message : String(err);
  const category = classifyUnknownError(err);
  return memoizedClassify(raw, category);
}

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

function buildClassifiedError(raw: string, category: ErrorCategory): ClassifiedError {
  return {
    raw,
    category,
    categoryLabel: categoryLabel(category),
    taxonomySeverity: defaultSeverity(category),
    autoFixable: isAutoFixable(category),
    failoverEligible: isFailoverEligible(category),
    friendly: resolveError(raw),
    explanation: getErrorExplanation(raw),
  };
}
