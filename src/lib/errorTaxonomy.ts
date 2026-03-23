/**
 * Unified error taxonomy shared between Rust backend and TypeScript frontend.
 *
 * This is the **single source of truth** for error classification on the TS side.
 * The Rust canonical definitions live in `src-tauri/src/engine/error_taxonomy.rs`.
 *
 * All subsystems (healing, failover, design drift, health check, degradation)
 * should import from here instead of maintaining independent heuristics.
 */

// ---------------------------------------------------------------------------
// ErrorCategory — mirrors Rust `ErrorCategory` (snake_case serde)
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'rate_limit'
  | 'session_limit'
  | 'timeout'
  | 'provider_not_found'
  | 'credential_error'
  | 'network'
  | 'validation'
  | 'tool_error'
  | 'api_error'
  | 'unknown';

// ---------------------------------------------------------------------------
// ErrorSeverity — mirrors Rust `ErrorSeverity`
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an error into an {@link ErrorCategory}.
 *
 * This mirrors the Rust `error_taxonomy::classify_error` function so both
 * sides produce identical classifications.
 */
export function classifyError(error: string): ErrorCategory {
  const lower = error.toLowerCase();

  // Rate limit
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota exceeded') ||
    lower.includes('usage limit') ||
    lower.includes('429')
  ) {
    return 'rate_limit';
  }

  // Session limit
  if (lower.includes('session limit')) {
    return 'session_limit';
  }

  // Timeout
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('deadline') || lower.includes('etimedout')) {
    return 'timeout';
  }

  // Provider not found
  if (
    lower.includes('not found') ||
    lower.includes('enoent') ||
    lower.includes('is not recognized')
  ) {
    return 'provider_not_found';
  }

  // Credential / auth
  if (
    lower.includes('decrypt') ||
    lower.includes('credential') ||
    lower.includes('api key') ||
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return 'credential_error';
  }

  // Network
  if (
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('err_network') ||
    lower.includes('connection refused') ||
    lower.includes('dns') ||
    (lower.includes('fetch') && lower.includes('fail'))
  ) {
    return 'network';
  }

  // Tool errors
  if (
    lower.includes('tool_use') ||
    (lower.includes('tool') && (lower.includes('fail') || lower.includes('error'))) ||
    (lower.includes('function') && lower.includes('error'))
  ) {
    return 'tool_error';
  }

  // API / server errors
  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('api error') ||
    lower.includes('server error') ||
    lower.includes('internal server')
  ) {
    return 'api_error';
  }

  // Validation
  if (
    lower.includes('validation') ||
    lower.includes('invalid') ||
    lower.includes('malformed') ||
    lower.includes('parse error')
  ) {
    return 'validation';
  }

  return 'unknown';
}

/**
 * Classify from an unknown error value (Error object, string, or other).
 */
export function classifyUnknownError(err: unknown): ErrorCategory {
  const msg = err instanceof Error ? err.message : String(err);
  return classifyError(msg);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Categories that the healing engine can automatically retry. */
export function isAutoFixable(category: ErrorCategory): boolean {
  return category === 'rate_limit' || category === 'timeout';
}

/** Categories that should trigger provider failover. */
export function isFailoverEligible(category: ErrorCategory): boolean {
  return (
    category === 'provider_not_found' ||
    category === 'rate_limit' ||
    category === 'session_limit' ||
    category === 'timeout'
  );
}

/** Default severity for a given category. */
export function defaultSeverity(category: ErrorCategory): ErrorSeverity {
  switch (category) {
    case 'provider_not_found': return 'critical';
    case 'credential_error':
    case 'session_limit':
    case 'api_error': return 'high';
    case 'rate_limit':
    case 'timeout':
    case 'tool_error':
    case 'network': return 'medium';
    case 'validation': return 'low';
    case 'unknown': return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Issue severity inference (shared by health check, dry run, and digest)
// ---------------------------------------------------------------------------

/**
 * Infer issue severity from health-check / feasibility issue text.
 *
 * Previously duplicated in healthCheckSlice.ts, useDryRun.ts, and
 * useHealthCheck.ts. Centralized here so all subsystems produce consistent
 * severity classifications.
 */
export function inferIssueSeverity(issueText: string, overall: string): 'error' | 'warning' | 'info' {
  const lower = issueText.toLowerCase();
  if (overall === 'blocked' || lower.includes('missing') || lower.includes('required') || lower.includes('must')) {
    return 'error';
  }
  if (lower.includes('recommend') || lower.includes('consider') || lower.includes('optional') || lower.includes('suggest')) {
    return 'info';
  }
  return 'warning';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a category. */
export function categoryLabel(category: ErrorCategory): string {
  switch (category) {
    case 'rate_limit': return 'Rate Limit';
    case 'session_limit': return 'Session Limit';
    case 'timeout': return 'Timeout';
    case 'provider_not_found': return 'Provider Not Found';
    case 'credential_error': return 'Credential Error';
    case 'network': return 'Network';
    case 'validation': return 'Validation';
    case 'tool_error': return 'Tool Error';
    case 'api_error': return 'API Error';
    case 'unknown': return 'Unknown';
  }
}
