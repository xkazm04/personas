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
