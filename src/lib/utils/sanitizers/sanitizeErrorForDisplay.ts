/**
 * Sanitize error messages for user-facing display.
 *
 * Detects internal details (SQL, stack traces, file paths, internal identifiers)
 * and replaces them with user-friendly messages. Full details are logged to the
 * console for debugging. Safe messages (timeouts, "service unavailable", etc.)
 * pass through after basic redaction.
 */

import { sanitizeErrorMessage } from './maskSensitive';

/** Patterns that indicate the message contains internal implementation details */
const INTERNAL_DETAIL_PATTERNS = [
  /\bSELECT\b.*\bFROM\b/i,       // SQL queries
  /\bINSERT\b.*\bINTO\b/i,
  /\bUPDATE\b.*\bSET\b/i,
  /\bDELETE\b.*\bFROM\b/i,
  /\bCREATE\b.*\bTABLE\b/i,
  /\bALTER\b.*\bTABLE\b/i,
  /\bat\s+[\w$.]+\s*\(/,          // Stack trace frames: "at Module.fn ("
  /\bat\s+[\w/\\]+\.(?:rs|ts|js):\d+/i, // Stack traces with file:line
  /panicked at/i,                  // Rust panics
  /thread '.*' panicked/i,
  /SQLITE_/,                       // SQLite error codes
  /diesel::/i,                     // Rust ORM internals
  /sqlx::/i,
  /rusqlite::/i,
  /serde_json::/i,                 // Serialization internals
  /tokio::/i,                      // Runtime internals
  /tauri::/i,                      // Framework internals
  /\.unwrap\(\)/,                  // Rust unwrap traces
  /BACKTRACE/,                     // Full backtraces
  /src[\\/][\w/\\]+\.rs:\d+/,     // Rust source paths
];

/** Known safe error prefixes that can be shown directly after redaction */
const SAFE_USER_MESSAGES: Array<[RegExp, string]> = [
  [/^\[Temporary\]\s*/i, ''],      // Strip transient prefix, keep message
  [/^network\b/i, 'A network error occurred. Please check your connection and try again.'],
  [/^timeout\b|timed?\s*out/i, 'The request timed out. Please try again.'],
  [/service unavailable/i, 'The service is temporarily unavailable. Please try again shortly.'],
  [/too many requests/i, 'Too many requests. Please wait a moment and try again.'],
  [/bad gateway/i, 'The service is temporarily unavailable. Please try again shortly.'],
];

/** Generic fallback shown when we redact internal details */
const GENERIC_ERROR = 'Something went wrong. Please try again or contact support if the issue persists.';

/**
 * Sanitize an error message for user-facing display.
 *
 * - If the message contains internal details (SQL, stack traces, etc.), it is
 *   replaced with a generic user-friendly message and logged to the console.
 * - If the message is safe, it passes through after basic redaction (paths, IPs,
 *   secrets are stripped).
 * - Returns a user-friendly string suitable for rendering in the UI.
 */
export function sanitizeErrorForDisplay(raw: string | null | undefined, context?: string): string {
  if (!raw) return GENERIC_ERROR;

  // Check for internal implementation details
  for (const pattern of INTERNAL_DETAIL_PATTERNS) {
    if (pattern.test(raw)) {
      console.error(`[${context ?? 'error'}] Internal error detail redacted from UI:`, raw);
      return GENERIC_ERROR;
    }
  }

  // Check for known safe patterns with specific user-friendly rewrites
  for (const [pattern, replacement] of SAFE_USER_MESSAGES) {
    if (pattern.test(raw)) {
      if (replacement) return replacement;
      // Empty replacement means strip the matched prefix and continue processing
      raw = raw.replace(pattern, '');
    }
  }

  // Apply existing redaction (file paths, IPs, secrets) and check if it changed
  const redacted = sanitizeErrorMessage(raw);
  if (redacted !== raw) {
    // Something was redacted — the original had sensitive content
    console.error(`[${context ?? 'error'}] Error message redacted for UI:`, raw);
  }

  return redacted;
}
