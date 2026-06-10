/**
 * Translated error resolution hook.
 *
 * Wraps the existing `resolveError()` from errorRegistry.ts and replaces its
 * hardcoded English strings with i18n-resolved translations. The original
 * `resolveError()` remains unchanged for backward compatibility — new code
 * should prefer this hook instead.
 *
 * @example
 *   const { resolveErrorT, friendlySeverityT } = useTranslatedError();
 *   const { message, suggestion } = resolveErrorT(rawError);
 *   const label = friendlySeverityT('critical'); // "Needs immediate attention" (translated)
 */
import * as Sentry from '@sentry/react';
import type { Translations } from './en';
import { resolveError, type FriendlyErrorCategory } from '@/lib/errors/errorRegistry';

// Breadcrumb dedupe window — when the same raw error gets rendered repeatedly
// (e.g. a hook firing on every render until the error clears), avoid flooding
// Sentry's breadcrumb buffer with duplicates. The first occurrence wins.
const BREADCRUMB_DEDUP_MS = 1000;
let _lastBreadcrumbKey = '';
let _lastBreadcrumbAt = 0;

function recordResolveBreadcrumb(raw: string, keyPrefix: string | null) {
  const now = Date.now();
  // Dedupe key includes prefix so a re-classification (same raw → different
  // resolved key) still surfaces.
  const dedupeKey = `${keyPrefix ?? '_unmatched'}::${raw}`;
  if (dedupeKey === _lastBreadcrumbKey && now - _lastBreadcrumbAt < BREADCRUMB_DEDUP_MS) {
    return;
  }
  _lastBreadcrumbKey = dedupeKey;
  _lastBreadcrumbAt = now;

  // Sentry's before_breadcrumb hook (src/lib/sentry.ts) already scrubs PII
  // from the message field and from data fields. Calling addBreadcrumb is
  // safe before Sentry.init (no-op) and after (recorded on the active scope).
  Sentry.addBreadcrumb({
    category: 'error.resolved',
    level: 'warning',
    message: raw,
    data: {
      keyPrefix: keyPrefix ?? '_unmatched',
    },
  });
}

export interface TranslatedError {
  message: string;
  suggestion: string;
  category: FriendlyErrorCategory;
}

// Map raw error match patterns → i18n key prefixes in error_registry section.
// Order matters: most specific patterns first (mirrors errorRegistry.ts).
// Each entry's `category` mirrors the same field on the corresponding rule
// in errorRegistry.ts — keep the two in sync when adding new rules.
const ERROR_KEY_MAP: Array<{ match: string | RegExp; keyPrefix: string; category: FriendlyErrorCategory }> = [
  { match: 'NetworkOffline', keyPrefix: 'network_offline', category: 'system' },
  { match: 'timed out', keyPrefix: 'timed_out', category: 'recoverable' },
  { match: 'Failed to build HTTP client', keyPrefix: 'http_client', category: 'system' },
  { match: 'Auth token missing or invalid', keyPrefix: 'auth_invalid', category: 'user_action' },
  { match: 'Session expired', keyPrefix: 'session_expired', category: 'user_action' },
  { match: 'OAuth authorization timed out', keyPrefix: 'oauth_timeout', category: 'user_action' },
  { match: 'permission denied', keyPrefix: 'permission_denied', category: 'user_action' },
  { match: 'Forbidden', keyPrefix: 'forbidden', category: 'user_action' },
  // Usage-limit caps before the generic rate-limit rules — "usage limit
  // reached" also contains no "rate limit" substring, but keep specificity
  // ordering explicit. Weekly before window (both contain "usage limit").
  { match: 'weekly usage limit reached', keyPrefix: 'usage_limit_weekly', category: 'user_action' },
  { match: 'usage limit reached', keyPrefix: 'usage_limit_window', category: 'recoverable' },
  { match: 'rate limit exceeded', keyPrefix: 'rate_limit', category: 'recoverable' },
  { match: 'RateLimited', keyPrefix: 'rate_limited', category: 'recoverable' },
  { match: 'Budget limit exceeded', keyPrefix: 'budget_limit', category: 'user_action' },
  { match: 'budget exceeded', keyPrefix: 'budget_exceeded', category: 'user_action' },
  { match: 'Claude CLI not found', keyPrefix: 'cli_not_found', category: 'system' },
  { match: 'CLAUDECODE environment variable', keyPrefix: 'cli_config_conflict', category: 'recoverable' },
  { match: 'Claude CLI exited with error', keyPrefix: 'cli_error', category: 'recoverable' },
  { match: 'CLI produced no output', keyPrefix: 'cli_no_output', category: 'recoverable' },
  { match: 'Failed to extract connector design', keyPrefix: 'connector_design', category: 'user_action' },
  { match: 'Failed to generate', keyPrefix: 'generation_failed', category: 'recoverable' },
  { match: 'Invalid JSON', keyPrefix: 'invalid_json', category: 'user_action' },
  // Must come before the generic 'Validation' rule — n8n shape errors are
  // emitted from create_n8n_session (commands/design/n8n_sessions.rs) and need
  // a more actionable, link-bearing message than the generic validation copy.
  { match: 'is not a valid n8n workflow export', keyPrefix: 'n8n_invalid_shape', category: 'user_action' },
  { match: 'Validation', keyPrefix: 'validation', category: 'user_action' },
  { match: 'Request body too large', keyPrefix: 'body_too_large', category: 'user_action' },
  { match: 'is too large for OCR', keyPrefix: 'ocr_file_too_large', category: 'user_action' },
  { match: 'Decryption failed', keyPrefix: 'decryption', category: 'user_action' },
  { match: 'Circular chain detected', keyPrefix: 'circular_chain', category: 'user_action' },
  { match: 'NotFound', keyPrefix: 'not_found', category: 'recoverable' },
  { match: 'Connection limit reached', keyPrefix: 'connection_limit', category: 'system' },
  { match: /Webhook returned HTTP \d+/, keyPrefix: 'webhook_error', category: 'system' },
  { match: 'Cannot reach Zapier hook', keyPrefix: 'zapier', category: 'user_action' },
  { match: 'is not active', keyPrefix: 'inactive', category: 'user_action' },
  { match: 'no webhook URL configured', keyPrefix: 'no_webhook', category: 'user_action' },
  { match: 'no platform credential configured', keyPrefix: 'no_credential', category: 'user_action' },
  { match: 'Bundle file is empty or unreadable', keyPrefix: 'empty_bundle', category: 'user_action' },
  { match: 'ZIP archive does not contain manifest', keyPrefix: 'invalid_bundle', category: 'user_action' },
];

type ErrorRegistryKeys = Translations['error_registry'];

function getRegistryString(registry: ErrorRegistryKeys, key: string): string | undefined {
  return (registry as Record<string, string | undefined>)[key];
}

/**
 * Resolve a raw error string to a translated user-friendly message + suggestion.
 * Falls back to the generic message for unrecognised errors.
 */
export function resolveErrorTranslated(t: Translations, raw: string | null | undefined): TranslatedError {
  const registry = t.error_registry;
  const fallback: TranslatedError = {
    message: getRegistryString(registry, 'generic_message') ?? 'Something went wrong.',
    suggestion: getRegistryString(registry, 'generic_suggestion') ?? 'Try again.',
    category: 'unclassified',
  };

  if (!raw) return fallback;

  for (const rule of ERROR_KEY_MAP) {
    const matches =
      typeof rule.match === 'string'
        ? raw.includes(rule.match)
        : rule.match.test(raw);
    if (matches) {
      // Record a Sentry breadcrumb with the raw error BEFORE the rewrite,
      // so an operator looking at a Sentry user-report ticket sees the
      // raw "Failed to build HTTP client: connect: certificate verify
      // failed" rather than only the friendly "Network is offline" copy.
      // Architect ADR: 2026-05-10-resolveerror-breadcrumb-spawn-tracing.
      recordResolveBreadcrumb(raw, rule.keyPrefix);
      return {
        message: getRegistryString(registry, `${rule.keyPrefix}_message`) ?? raw,
        suggestion: getRegistryString(registry, `${rule.keyPrefix}_suggestion`) ?? '',
        category: rule.category,
      };
    }
  }

  // A-grade Phase 6 (2026-05-03) — chain into the non-translated
  // errorRegistry as a final fallback. Lets new error patterns added
  // there (e.g. the build-pipeline validation rules) surface friendly
  // English messages immediately, without each rule needing a paired
  // entry in `ERROR_KEY_MAP` + `error_registry` i18n keys. Localised
  // versions can be added later by adding the keys to en.ts and
  // ERROR_KEY_MAP in tandem; until then English non-translated text
  // is strictly better than the raw Rust error string.
  const englishFriendly = resolveError(raw);
  if (englishFriendly.category !== 'unclassified') {
    // englishFriendly already records its own breadcrumb inside
    // resolveError() — don't double-record from here.
    return englishFriendly;
  }

  // Unmatched: still record the raw error so an unknown shape doesn't
  // disappear silently. The unclassified fallback returned to the user
  // is generic; Sentry needs the raw string for the operator's sake.
  recordResolveBreadcrumb(raw, null);
  return fallback;
}

/** Resolve severity token to translated label (for healing / alert toasts). */
export function friendlySeverityTranslated(t: Translations, severity: string): string {
  const key = `severity_${severity}`;
  return getRegistryString(t.error_registry, key) ?? severity;
}
