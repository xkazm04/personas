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
import type { Translations } from './en';
import type { FriendlyErrorCategory } from '@/lib/errors/errorRegistry';

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
      return {
        message: getRegistryString(registry, `${rule.keyPrefix}_message`) ?? raw,
        suggestion: getRegistryString(registry, `${rule.keyPrefix}_suggestion`) ?? '',
        category: rule.category,
      };
    }
  }

  return fallback;
}

/** Resolve severity token to translated label (for healing / alert toasts). */
export function friendlySeverityTranslated(t: Translations, severity: string): string {
  const key = `severity_${severity}`;
  return getRegistryString(t.error_registry, key) ?? severity;
}
