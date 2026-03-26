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

/**
 * Classify a raw error string through all three layers in a single pass.
 *
 * This is the primary entry point. Prefer this over calling `classifyError`,
 * `resolveError`, or `getErrorExplanation` independently.
 */
export function classifyErrorFull(raw: string): ClassifiedError {
  const category = classifyError(raw);
  return buildClassifiedError(raw, category);
}

/**
 * Classify from an unknown value (Error object, string, Tauri error, etc.).
 * Uses structured `kind` from Tauri errors when available.
 */
export function classifyUnknownErrorFull(err: unknown): ClassifiedError {
  const raw = err instanceof Error ? err.message : String(err);
  const category = classifyUnknownError(err);
  return buildClassifiedError(raw, category);
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
