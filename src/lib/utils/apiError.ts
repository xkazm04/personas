/**
 * Typed API error with transient/permanent classification and retry hints.
 *
 * Transient errors (network timeout, 503, connection reset) are safe to auto-retry.
 * Permanent errors (400, 404, validation failures) should be surfaced immediately.
 */

export type ErrorSeverity = 'transient' | 'permanent' | 'unknown';

export class ApiError extends Error {
  /** Whether this error is likely transient and retryable */
  readonly severity: ErrorSeverity;
  /** Suggested retry delay in ms, 0 if not retryable */
  readonly retryAfterMs: number;
  /** Original error for debugging */
  readonly cause: unknown;

  constructor(message: string, severity: ErrorSeverity, retryAfterMs: number, cause?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.severity = severity;
    this.retryAfterMs = retryAfterMs;
    this.cause = cause;
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

/**
 * Classify an unknown error into a typed ApiError with retry guidance.
 * Call this in catch blocks to get structured error information.
 */
export function classifyError(err: unknown, fallbackMessage: string): ApiError {
  const msg = extractErrorMessage(err, fallbackMessage);

  // Check transient patterns first (network issues are retryable)
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(msg)) {
      // 429 gets longer backoff
      const retryMs = /429|too many requests/i.test(msg) ? 5000 : 2000;
      return new ApiError(msg, 'transient', retryMs, err);
    }
  }

  // Check permanent patterns
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(msg)) {
      return new ApiError(msg, 'permanent', 0, err);
    }
  }

  // Default: unknown severity, allow one retry with moderate delay
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
