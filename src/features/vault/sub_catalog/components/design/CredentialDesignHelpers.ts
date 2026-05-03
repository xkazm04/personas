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

// `extractFirstUrl` hoisted to autoCredHelpers (Wave 5 consolidation).
// Uses the markdown-aware URL_REGEX so embedded URLs don't pick up trailing
// markdown punctuation.
export { extractFirstUrl } from '@/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers';

// -- OAuth field-name constants ----------------------------------
// Canonical keys injected by OAuth flows. Import these instead of
// hard-coding the strings so changes only need to happen in one place.

export const OAUTH_FIELD = {
  SCOPE: 'oauth_scope',
  COMPLETED_AT: 'oauth_completed_at',
  CLIENT_MODE: 'oauth_client_mode',
  PROVIDER: 'oauth_provider',
} as const;

// -- Credential flow discriminated union -------------------------

import { parseConnectorMetadata, type CredentialTemplateField, type ConnectorDefinition } from '@/lib/types/types';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { Translations } from '@/i18n/en';

/** Shape of `tx` returned by useTranslation — interpolates {placeholders}. */
type TxFn = (template: string, vars: Record<string, string | number>) => string;

/** Filter connector definitions to those with template_enabled metadata, optionally matching a search query. */
export function filterTemplateConnectors(
  connectorDefinitions: ConnectorDefinition[],
  searchQuery: string,
): ConnectorDefinition[] {
  return connectorDefinitions.filter((conn) => {
    const metadata = parseConnectorMetadata(conn.metadata);
    if (metadata.template_enabled !== true) return false;

    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      conn.label.toLowerCase().includes(q)
      || conn.name.toLowerCase().includes(q)
      || conn.category.toLowerCase().includes(q)
    );
  });
}

/** Build a CredentialDesignResult from a ConnectorDefinition template. */
export function buildTemplateResult(template: ConnectorDefinition): CredentialDesignResult {
  const metadata = parseConnectorMetadata(template.metadata);
  const setupInstructions = metadata.setup_instructions ?? '';
  const summary = metadata.summary ?? `${template.label} connector`;

  return {
    match_existing: template.name,
    connector: {
      name: template.name,
      label: template.label,
      category: template.category,
      color: template.color,
      fields: template.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
      })),
      healthcheck_config: template.healthcheck_config,
      services: template.services,
      events: template.events,
    },
    setup_instructions: setupInstructions,
    summary,
  };
}

export type CredentialFlow =
  | { kind: 'google_oauth'; providerLabel: string }
  | { kind: 'provider_oauth'; providerId: string; providerLabel: string }
  | { kind: 'api_key' };

/** Derive the credential flow variant from connector metadata and fields.
 *
 * Priority: explicit `oauthType` metadata > field-name heuristic > api_key fallback.
 * The field heuristic (client_id + client_secret + refresh_token) is only used
 * when `oauthType` is absent, to avoid false-positive Google matches for
 * non-Google OAuth providers that use the same standard field names.
 */
export function deriveCredentialFlow(
  oauthType: string | null | undefined,
  fieldKeys: Set<string>,
): CredentialFlow {
  // 1. Explicit oauthType takes priority
  if (oauthType === 'google') {
    return { kind: 'google_oauth', providerLabel: 'Google' };
  }
  if (oauthType) {
    return {
      kind: 'provider_oauth',
      providerId: oauthType,
      providerLabel: oauthType.charAt(0).toUpperCase() + oauthType.slice(1),
    };
  }
  // 2. Field-name heuristic only when no oauthType metadata is set
  if (fieldKeys.has('client_id') && fieldKeys.has('client_secret') && fieldKeys.has('refresh_token')) {
    return { kind: 'google_oauth', providerLabel: 'Google' };
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
    case 'provider_oauth': {
      if (!oauthValues.access_token) return false;
      // If this provider has a healthcheck endpoint, require it to pass
      if (PROVIDERS_WITH_HEALTHCHECK.has(flow.providerId.toLowerCase())) {
        return healthcheckSuccess;
      }
      return true;
    }
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
export function getSaveDisabledReason(flow: CredentialFlow, t: Translations, tx: TxFn): string {
  const dh = t.vault.design_helpers;
  switch (flow.kind) {
    case 'google_oauth':
      return dh.save_disabled_google_oauth;
    case 'provider_oauth':
      if (PROVIDERS_WITH_HEALTHCHECK.has(flow.providerId.toLowerCase())) {
        return tx(dh.save_disabled_provider_oauth_with_hc, { label: flow.providerLabel });
      }
      return tx(dh.save_disabled_provider_oauth, { label: flow.providerLabel });
    case 'api_key':
      return dh.save_disabled_api_key;
  }
}

/** OAuth consent hint displayed below the consent button. */
export function getOAuthConsentHint(flow: CredentialFlow, t: Translations, tx: TxFn): string | undefined {
  const dh = t.vault.design_helpers;
  switch (flow.kind) {
    case 'google_oauth':
      return dh.oauth_hint_google;
    case 'provider_oauth':
      return tx(dh.oauth_hint_provider, { label: flow.providerLabel });
    case 'api_key':
      return undefined;
  }
}

/** Whether the flow uses OAuth consent (Google or provider). */
export function isOAuthFlow(flow: CredentialFlow): boolean {
  return flow.kind === 'google_oauth' || flow.kind === 'provider_oauth';
}

/** Known OAuth providers with built-in healthcheck endpoints. */
const PROVIDERS_WITH_HEALTHCHECK = new Set([
  'github', 'slack', 'microsoft', 'atlassian',
  'discord', 'linear', 'notion', 'spotify',
]);

/** Whether to show the healthcheck (test connection) button. */
export function showsHealthcheck(flow: CredentialFlow): boolean {
  if (flow.kind === 'provider_oauth') {
    return PROVIDERS_WITH_HEALTHCHECK.has(flow.providerId.toLowerCase());
  }
  return true;
}

/** Whether to show the AI auto-provision negotiator. */
export function showsNegotiator(flow: CredentialFlow): boolean {
  return flow.kind !== 'google_oauth';
}

// -- Healthcheck message translation -----------------------------

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
export function translateHealthcheckMessage(raw: string, t: Translations, tx: TxFn): TranslatedHealthcheck {
  const dh = t.vault.design_helpers;
  const status = extractHttpStatus(raw);

  // Connection / network errors
  if (raw.includes('request failed:')) {
    if (raw.includes('timed out') || raw.includes('timeout')) {
      return { friendly: dh.hc_timeout_friendly, suggestion: dh.hc_timeout_suggestion, raw };
    }
    if (raw.includes('dns') || raw.includes('resolve')) {
      return { friendly: dh.hc_dns_friendly, suggestion: dh.hc_dns_suggestion, raw };
    }
    if (raw.includes('connection refused')) {
      return { friendly: dh.hc_refused_friendly, suggestion: dh.hc_refused_suggestion, raw };
    }
    return { friendly: dh.hc_unreachable_friendly, suggestion: dh.hc_unreachable_suggestion, raw };
  }

  // HTTP status codes
  if (status) {
    switch (status) {
      case 401:
        return { friendly: dh.hc_401_friendly, suggestion: dh.hc_401_suggestion, raw };
      case 403:
        return { friendly: dh.hc_403_friendly, suggestion: dh.hc_403_suggestion, raw };
      case 404:
        return { friendly: dh.hc_404_friendly, suggestion: dh.hc_404_suggestion, raw };
      case 429:
        return { friendly: dh.hc_429_friendly, suggestion: dh.hc_429_suggestion, raw };
      case 500:
      case 502:
      case 503:
      case 504:
        return { friendly: dh.hc_5xx_friendly, suggestion: dh.hc_5xx_suggestion, raw };
      default:
        if (status >= 400 && status < 500) {
          return {
            friendly: tx(dh.hc_4xx_friendly, { status }),
            suggestion: dh.hc_4xx_suggestion,
            raw,
          };
        }
    }
  }

  // Skip message
  if (raw.includes('skipped automatic healthcheck')) {
    return { friendly: dh.hc_skipped_friendly, suggestion: dh.hc_skipped_suggestion, raw };
  }

  // Local validation message — passes through untouched (already translated upstream)
  if (raw.includes('Run Test Connection') || raw === t.vault.credential_forms.healthcheck_required) {
    return { friendly: raw, suggestion: '', raw };
  }

  // Fallback
  return { friendly: raw, suggestion: '', raw };
}
