export const QUICK_SERVICE_HINTS = [
  'OpenAI API key',
  'GitHub personal access token',
  'Slack bot token',
  'Stripe secret key',
  'Notion integration token',
  'Datadog API key',
];

/** Brand colors for service hint chips (keyed by hint label). */
export const HINT_COLORS: Record<string, string> = {
  'OpenAI API key': '#10A37F',
  'GitHub personal access token': '#24292F',
  'Slack bot token': '#4A154B',
  'Stripe secret key': '#635BFF',
  'Notion integration token': '#000000',
  'Datadog API key': '#632CA6',
};

export function extractFirstUrl(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

// ── OAuth field-name constants ──────────────────────────────────
// Canonical keys injected by OAuth flows. Import these instead of
// hard-coding the strings so changes only need to happen in one place.

export const OAUTH_FIELD = {
  SCOPE: 'oauth_scope',
  COMPLETED_AT: 'oauth_completed_at',
  CLIENT_MODE: 'oauth_client_mode',
  PROVIDER: 'oauth_provider',
} as const;

// ── Credential flow discriminated union ─────────────────────────

import type { CredentialTemplateField } from '@/lib/types/types';

export type CredentialFlow =
  | { kind: 'google_oauth'; providerLabel: string }
  | { kind: 'provider_oauth'; providerId: string; providerLabel: string }
  | { kind: 'api_key' };

/** Derive the credential flow variant from connector metadata and fields. */
export function deriveCredentialFlow(
  oauthType: string | null | undefined,
  fieldKeys: Set<string>,
): CredentialFlow {
  if (
    oauthType === 'google'
    || (fieldKeys.has('client_id') && fieldKeys.has('client_secret') && fieldKeys.has('refresh_token'))
  ) {
    return { kind: 'google_oauth', providerLabel: 'Google' };
  }
  if (oauthType && oauthType !== 'google') {
    return {
      kind: 'provider_oauth',
      providerId: oauthType,
      providerLabel: oauthType.charAt(0).toUpperCase() + oauthType.slice(1),
    };
  }
  return { kind: 'api_key' };
}

/** Fields hidden from the user for each flow variant (auto-filled by OAuth). */
export function getHiddenFieldKeys(flow: CredentialFlow): string[] {
  switch (flow.kind) {
    case 'google_oauth':
      return ['client_id', 'client_secret', 'refresh_token', 'scopes'];
    case 'provider_oauth':
      return ['access_token', 'refresh_token', 'scopes', OAUTH_FIELD.SCOPE];
    case 'api_key':
      return [];
  }
}

/** Filter fields to only those the user should fill in. */
export function getEffectiveFields(
  fields: CredentialTemplateField[],
  flow: CredentialFlow,
): CredentialTemplateField[] {
  const hidden = getHiddenFieldKeys(flow);
  if (hidden.length === 0) return fields;
  return fields.filter((f) => !hidden.includes(f.key));
}

/** Whether save is gated by OAuth consent vs healthcheck. */
export function isSaveReady(
  flow: CredentialFlow,
  oauthValues: Record<string, string>,
  healthcheckSuccess: boolean,
  testedConfig: unknown,
): boolean {
  switch (flow.kind) {
    case 'google_oauth':
      return Boolean(oauthValues.refresh_token);
    case 'provider_oauth':
      return Boolean(oauthValues.access_token);
    case 'api_key':
      return healthcheckSuccess && testedConfig !== null;
  }
}

/** Provider label for display purposes. */
export function getProviderLabel(flow: CredentialFlow): string {
  switch (flow.kind) {
    case 'google_oauth':
      return flow.providerLabel;
    case 'provider_oauth':
      return flow.providerLabel;
    case 'api_key':
      return '';
  }
}

/** User-facing explanation for why save is disabled. */
export function getSaveDisabledReason(flow: CredentialFlow): string {
  switch (flow.kind) {
    case 'google_oauth':
      return 'Save is unlocked after Google consent returns a refresh token.';
    case 'provider_oauth':
      return `Save is unlocked after ${flow.providerLabel} authorization completes.`;
    case 'api_key':
      return 'Save is locked until Test Connection succeeds for the current credential values.';
  }
}

/** OAuth consent hint displayed below the consent button. */
export function getOAuthConsentHint(flow: CredentialFlow): string | undefined {
  switch (flow.kind) {
    case 'google_oauth':
      return 'One click consent using app-managed Google OAuth. You can uncheck permissions on the consent screen.';
    case 'provider_oauth':
      return `Enter your ${flow.providerLabel} OAuth client credentials above, then click to authorize.`;
    case 'api_key':
      return undefined;
  }
}

/** Whether the flow uses OAuth consent (Google or provider). */
export function isOAuthFlow(flow: CredentialFlow): boolean {
  return flow.kind === 'google_oauth' || flow.kind === 'provider_oauth';
}

/** Whether to show the healthcheck (test connection) button. */
export function showsHealthcheck(flow: CredentialFlow): boolean {
  return flow.kind !== 'provider_oauth';
}

/** Whether to show the AI auto-provision negotiator. */
export function showsNegotiator(flow: CredentialFlow): boolean {
  return flow.kind !== 'google_oauth';
}

// ── Healthcheck message translation ─────────────────────────────

export interface TranslatedHealthcheck {
  friendly: string;
  suggestion: string;
  raw: string;
}

/** Extract HTTP status code from raw healthcheck message. */
function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/HTTP (\d{3})/);
  const code = match?.[1];
  return code ? parseInt(code, 10) : null;
}

/** Translate raw backend healthcheck messages into user-friendly guidance. */
export function translateHealthcheckMessage(raw: string): TranslatedHealthcheck {
  const status = extractHttpStatus(raw);

  // Connection / network errors
  if (raw.includes('request failed:')) {
    if (raw.includes('timed out') || raw.includes('timeout')) {
      return {
        friendly: 'Could not reach the service — the request timed out.',
        suggestion: 'Check that the URL is correct and the service is online. Your firewall or proxy may be blocking the connection.',
        raw,
      };
    }
    if (raw.includes('dns') || raw.includes('resolve')) {
      return {
        friendly: 'Could not reach the service — the hostname could not be resolved.',
        suggestion: 'Double-check the service URL for typos. Make sure you have an active internet connection.',
        raw,
      };
    }
    if (raw.includes('connection refused')) {
      return {
        friendly: 'Connection refused by the service.',
        suggestion: 'The service may be down or the URL/port may be incorrect. Verify the endpoint address.',
        raw,
      };
    }
    return {
      friendly: 'Could not reach the service — check the URL.',
      suggestion: 'Verify your internet connection and that the service endpoint is correct.',
      raw,
    };
  }

  // HTTP status codes
  if (status) {
    switch (status) {
      case 401:
        return {
          friendly: 'Your credentials appear to be invalid or expired.',
          suggestion: 'Double-check the API key or token — make sure you copied the full value without extra spaces.',
          raw,
        };
      case 403:
        return {
          friendly: 'Your credentials lack the required permissions.',
          suggestion: 'The key is valid but does not have access to this endpoint. Check your API key\'s scopes or role assignments.',
          raw,
        };
      case 404:
        return {
          friendly: 'The healthcheck endpoint was not found.',
          suggestion: 'This usually means the generated test URL is wrong — not a problem with your credentials. Try saving anyway if you trust the key.',
          raw,
        };
      case 429:
        return {
          friendly: 'Too many requests — the service is rate-limiting you.',
          suggestion: 'Wait a moment and try again. This doesn\'t necessarily mean your credentials are wrong.',
          raw,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          friendly: 'The service returned a server error.',
          suggestion: 'This is likely a temporary issue on the provider\'s side. Try again in a few minutes.',
          raw,
        };
      default:
        if (status >= 400 && status < 500) {
          return {
            friendly: `The service rejected the request (HTTP ${status}).`,
            suggestion: 'Verify your credentials and ensure the API key has the correct permissions.',
            raw,
          };
        }
    }
  }

  // Skip message
  if (raw.includes('skipped automatic healthcheck')) {
    return {
      friendly: 'Automatic testing was skipped for this service.',
      suggestion: 'You can save the credential and test it manually by running your agent.',
      raw,
    };
  }

  // Local validation message
  if (raw.includes('Run Test Connection')) {
    return {
      friendly: raw,
      suggestion: '',
      raw,
    };
  }

  // Fallback
  return {
    friendly: raw,
    suggestion: '',
    raw,
  };
}
