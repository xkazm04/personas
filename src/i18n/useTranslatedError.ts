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

export interface TranslatedError {
  message: string;
  suggestion: string;
}

// Map raw error match patterns → i18n key prefixes in error_registry section.
// Order matters: most specific patterns first (mirrors errorRegistry.ts).
const ERROR_KEY_MAP: Array<{ match: string | RegExp; keyPrefix: string }> = [
  { match: 'NetworkOffline', keyPrefix: 'network_offline' },
  { match: 'timed out', keyPrefix: 'timed_out' },
  { match: 'Failed to build HTTP client', keyPrefix: 'http_client' },
  { match: 'Auth token missing or invalid', keyPrefix: 'auth_invalid' },
  { match: 'Session expired', keyPrefix: 'session_expired' },
  { match: 'OAuth authorization timed out', keyPrefix: 'oauth_timeout' },
  { match: 'permission denied', keyPrefix: 'permission_denied' },
  { match: 'Forbidden', keyPrefix: 'forbidden' },
  { match: 'rate limit exceeded', keyPrefix: 'rate_limit' },
  { match: 'RateLimited', keyPrefix: 'rate_limited' },
  { match: 'Budget limit exceeded', keyPrefix: 'budget_limit' },
  { match: 'budget exceeded', keyPrefix: 'budget_exceeded' },
  { match: 'Claude CLI not found', keyPrefix: 'cli_not_found' },
  { match: 'CLAUDECODE environment variable', keyPrefix: 'cli_config_conflict' },
  { match: 'Claude CLI exited with error', keyPrefix: 'cli_error' },
  { match: 'CLI produced no output', keyPrefix: 'cli_no_output' },
  { match: 'Failed to extract connector design', keyPrefix: 'connector_design' },
  { match: 'Failed to generate', keyPrefix: 'generation_failed' },
  { match: 'Invalid JSON', keyPrefix: 'invalid_json' },
  { match: 'Validation', keyPrefix: 'validation' },
  { match: 'Request body too large', keyPrefix: 'body_too_large' },
  { match: 'Decryption failed', keyPrefix: 'decryption' },
  { match: 'Circular chain detected', keyPrefix: 'circular_chain' },
  { match: 'NotFound', keyPrefix: 'not_found' },
  { match: 'Connection limit reached', keyPrefix: 'connection_limit' },
  { match: /Webhook returned HTTP \d+/, keyPrefix: 'webhook_error' },
  { match: 'Cannot reach Zapier hook', keyPrefix: 'zapier' },
  { match: 'is not active', keyPrefix: 'inactive' },
  { match: 'no webhook URL configured', keyPrefix: 'no_webhook' },
  { match: 'no platform credential configured', keyPrefix: 'no_credential' },
  { match: 'Bundle file is empty or unreadable', keyPrefix: 'empty_bundle' },
  { match: 'ZIP archive does not contain manifest', keyPrefix: 'invalid_bundle' },
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
