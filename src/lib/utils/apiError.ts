/**
 * Typed API error with transient/permanent classification and retry hints.
 *
 * Transient errors (network timeout, 503, connection reset) are safe to auto-retry.
 * Permanent errors (400, 404, validation failures) should be surfaced immediately.
 *
 * When a structured Tauri error (`{ error, kind }`) is available, classification
 * uses the `kind` field directly instead of regex-matching the message string.
 */

import { isTauriError, type TauriErrorKind } from '@/lib/types/tauriError';

export type ErrorSeverity = 'transient' | 'permanent' | 'unknown';

export class ApiError extends Error {
  /** Whether this error is likely transient and retryable */
  readonly severity: ErrorSeverity;
  /** Suggested retry delay in ms, 0 if not retryable */
  readonly retryAfterMs: number;
  /** Original error for debugging */
  readonly cause: unknown;
  /** Structured error kind from the Rust backend, if available */
  readonly kind: TauriErrorKind | undefined;

  constructor(message: string, severity: ErrorSeverity, retryAfterMs: number, cause?: unknown, kind?: TauriErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.severity = severity;
    this.retryAfterMs = retryAfterMs;
    this.cause = cause;
    this.kind = kind;
  }

  get isTransient(): boolean {
    return this.severity === 'transient';
  }

  get isPermanent(): boolean {
    return this.severity === 'permanent';
  }
}

/** Patterns indicating transient failures */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /econnreset/i,
  /econnrefused/i,
  /enetunreach/i,
  /epipe/i,
  /network/i,
  /503/,
  /502/,
  /429/,
  /service unavailable/i,
  /bad gateway/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /connection\s*(was\s+)?reset/i,
  /deadline exceeded/i,
  /try again/i,
];

/** Patterns indicating permanent failures */
const PERMANENT_PATTERNS = [
  /400/,
  /401/,
  /403/,
  /404/,
  /405/,
  /422/,
  /invalid/i,
  /not found/i,
  /unauthorized/i,
  /forbidden/i,
  /malformed/i,
  /validation/i,
  /parse error/i,
  /missing required/i,
];

/** Transient kinds that are safe to auto-retry. */
const TRANSIENT_KINDS: ReadonlySet<TauriErrorKind> = new Set([
  'network_offline',
  'rate_limited',
  'cloud',     // cloud calls can be retried
  'pool',      // connection pool exhaustion is transient
]);

/** Permanent kinds that should be surfaced immediately. */
const PERMANENT_KINDS: ReadonlySet<TauriErrorKind> = new Set([
  'not_found',
  'validation',
  'serde',
  'auth',
  'forbidden',
]);

/**
 * Classify an unknown error into a typed ApiError with retry guidance.
 * When the error is a structured Tauri response with a `kind` field,
 * classification uses the kind directly — no regex needed.
 * Falls back to regex pattern matching for non-Tauri errors.
 */
export function classifyError(err: unknown, fallbackMessage: string): ApiError {
  const msg = extractErrorMessage(err, fallbackMessage);

  // Fast path: structured Tauri error with a kind field
  if (isTauriError(err)) {
    const { kind } = err;
    if (TRANSIENT_KINDS.has(kind)) {
      const retryMs = kind === 'rate_limited' ? 5000 : 2000;
      return new ApiError(msg, 'transient', retryMs, err, kind);
    }
    if (PERMANENT_KINDS.has(kind)) {
      return new ApiError(msg, 'permanent', 0, err, kind);
    }
    // Known kind but neither transient nor permanent (database, io, execution, etc.)
    return new ApiError(msg, 'unknown', 3000, err, kind);
  }

  // Fallback: regex-based classification for non-Tauri errors
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(msg)) {
      const retryMs = /429|too many requests/i.test(msg) ? 5000 : 2000;
      return new ApiError(msg, 'transient', retryMs, err);
    }
  }

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(msg)) {
      return new ApiError(msg, 'permanent', 0, err);
    }
  }

  return new ApiError(msg, 'unknown', 3000, err);
}

/** Extract a human-readable message from any error shape */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    if ('error' in err) return String((err as Record<string, unknown>).error);
    if ('message' in err) return String((err as Record<string, unknown>).message);
  }
  return fallback;
}

/**
 * Wrap a promise with automatic retry for transient errors.
 * Only retries once to avoid cascading failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const classified = classifyError(err, fallbackMessage);
    if (classified.isTransient && classified.retryAfterMs > 0) {
      await new Promise(resolve => setTimeout(resolve, classified.retryAfterMs));
      try {
        return await fn();
      } catch (retryErr) {
        throw classifyError(retryErr, fallbackMessage);
      }
    }
    throw classified;
  }
}
