/**
 * Typed API error with transient/permanent classification and retry hints.
 *
 * Transient errors (network timeout, 503, connection reset) are safe to auto-retry.
 * Permanent errors (400, 404, validation failures) should be surfaced immediately.
 * On the regex fallback path a declared status code decides first, then permanent
 * patterns, then transient -- permanent wins overlaps so a message that merely
 * mentions a transient word is not retried forever.
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

/**
 * Word patterns indicating transient failures.
 *
 * **No bare status numbers here.** `/503/` and friends used to live in these
 * lists and matched any three-digit run anywhere in the text -- an entity id, a
 * byte count, a port -- so "queued 502 of 900 rows" classified as transient.
 * Status codes are now read by `httpStatusFrom`, which only accepts a number
 * the message actually presents *as* a status.
 */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /econnreset/i,
  /econnrefused/i,
  /enetunreach/i,
  /epipe/i,
  /network/i,
  /service unavailable/i,
  /bad gateway/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /connection\s*(was\s+)?reset/i,
  /deadline exceeded/i,
  /try again/i,
];

/** Word patterns indicating permanent failures. See the note above on numbers. */
const PERMANENT_PATTERNS = [
  /invalid/i,
  /not found/i,
  /unauthorized/i,
  /forbidden/i,
  /malformed/i,
  /validation/i,
  /parse error/i,
  /missing required/i,
];

/** HTTP status codes worth another attempt. */
const TRANSIENT_STATUS: ReadonlySet<number> = new Set([429, 502, 503]);

/** HTTP status codes that a retry cannot fix. */
const PERMANENT_STATUS: ReadonlySet<number> = new Set([400, 401, 403, 404, 405, 422]);

/**
 * Matches a three-digit number only where the message presents it *as* a status
 * code -- `HTTP 503`, `status 429`, `status code: 400`, `error 403`, or a
 * leading `404 Not Found`. Anything else that merely contains three digits is
 * not a classification signal.
 */
const HTTP_STATUS_RE = /(?:\b(?:https?|status(?:\s*code)?|code|error)\b\W{0,4}|^\s*)([1-5]\d{2})\b/i;

function httpStatusFrom(msg: string): number | undefined {
  const match = HTTP_STATUS_RE.exec(msg);
  return match ? Number(match[1]) : undefined;
}

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
 * Retry delay attached to an `unknown`-severity error: **zero, because nothing
 * retries it.**
 *
 * This was `3000`, and `withRetry` gates on `isTransient`, which is false for
 * `unknown` — so the number was never read. That is the dangerous way for a
 * field to be wrong: it reads as a *missing* retry, and the obvious "fix" is to
 * widen the gate — which would start retrying every uncovered kind, including
 * `execution` (re-running a persona) and `io`, where a second attempt is not
 * safe to assume idempotent. The invariant is now explicit and testable:
 * **`retryAfterMs > 0` if and only if the error is transient.** Widening retry
 * to a specific kind means moving that kind into `TRANSIENT_KINDS`, deliberately
 * and one at a time — not flipping a gate for the whole residue.
 */
const UNKNOWN_RETRY_AFTER_MS = 0;

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
    // Known kind but neither transient nor permanent (database, io, execution,
    // process_spawn, gitlab, internal, external, …). See UNKNOWN_RETRY_AFTER_MS.
    return new ApiError(msg, 'unknown', UNKNOWN_RETRY_AFTER_MS, err, kind);
  }

  // Fallback: regex-based classification for non-Tauri errors.
  //
  // The order below is load-bearing and used to be the other way round. A status
  // code the message actually declares is the strongest signal, so it decides on
  // its own. After that PERMANENT wins every overlap, because the two
  // vocabularies intersect and transient-first meant the overlap was always
  // retried: "Invalid network configuration" carries /network/i, and
  // "400 Bad Request - please try again" carries /try again/i. Neither retry can
  // succeed, so both only delayed the report the user was waiting for.
  const status = httpStatusFrom(msg);
  if (status !== undefined) {
    if (TRANSIENT_STATUS.has(status)) {
      return new ApiError(msg, 'transient', status === 429 ? 5000 : 2000, err);
    }
    if (PERMANENT_STATUS.has(status)) {
      return new ApiError(msg, 'permanent', 0, err);
    }
  }

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(msg)) {
      return new ApiError(msg, 'permanent', 0, err);
    }
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(msg)) {
      const retryMs = /too many requests/i.test(msg) ? 5000 : 2000;
      return new ApiError(msg, 'transient', retryMs, err);
    }
  }

  return new ApiError(msg, 'unknown', UNKNOWN_RETRY_AFTER_MS, err);
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
 * Wrap a promise with automatic retry for **transient** errors only.
 * Only retries once to avoid cascading failures.
 *
 * `unknown` severity is deliberately not retried — see `UNKNOWN_RETRY_AFTER_MS`.
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
