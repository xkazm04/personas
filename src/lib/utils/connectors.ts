import type { ConnectorDefinition } from '@/lib/types/types';

/**
 * Checks whether a connector represents a Google OAuth integration.
 * Optionally accepts a serviceType (e.g. from a credential) for broader matching.
 */
export function isGoogleOAuthConnector(
  connector: ConnectorDefinition,
  serviceType?: string,
): boolean {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  return metadata.oauth_type === 'google'
    || connector.name === 'google_workspace_oauth_template'
    || (serviceType != null && serviceType.includes('google'));
}

/**
 * Checks whether a connector uses the universal OAuth gateway (non-Google).
 * These connectors have `auth_type: "oauth"` and an `oauth_provider_id` in metadata.
 */
export function isUniversalOAuthConnector(connector: ConnectorDefinition): boolean {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  return metadata.auth_type === 'oauth'
    && typeof metadata.oauth_provider_id === 'string'
    && metadata.oauth_type !== 'google';
}

/**
 * Get the OAuth provider ID from connector metadata (for universal OAuth).
 */
export function getOAuthProviderId(connector: ConnectorDefinition): string | null {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  return typeof metadata.oauth_provider_id === 'string' ? metadata.oauth_provider_id : null;
}

/**
 * Get the default OAuth scopes from connector metadata.
 */
export function getOAuthScopes(connector: ConnectorDefinition): string[] {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  return Array.isArray(metadata.oauth_scopes) ? metadata.oauth_scopes as string[] : [];
}
