import { useMemo, useEffect } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { getConnectorMeta, type ConnectorMeta } from '@/lib/connectors/connectorMeta';

export interface HealthyConnector {
  name: string;
  meta: ConnectorMeta;
  credentialId: string;
  category: string;
}

/**
 * Returns connectors that have at least one credential with a successful healthcheck.
 * Joins vault credentials with connector definitions, filtering by health status.
 */
export function useHealthyConnectors(): HealthyConnector[] {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);

  // Ensure vault data is loaded
  useEffect(() => {
    if (!credentials.length) fetchCredentials();
    if (!connectorDefinitions.length) fetchConnectorDefinitions();
  }, [connectorDefinitions.length, credentials.length, fetchConnectorDefinitions, fetchCredentials]);

  return useMemo(() => {
    if (!credentials.length || !connectorDefinitions.length) return [];

    const healthy: HealthyConnector[] = [];
    const seen = new Set<string>();

    for (const cred of credentials) {
      if (seen.has(cred.service_type)) continue;

      // Verify connector definition exists
      const connector = connectorDefinitions.find((c) => c.name === cred.service_type);
      if (!connector) continue;

      // External connectors must have passed a healthcheck. Zero-config
      // built-ins (Local Database/Drive/Messaging/Vector DB) have no
      // healthcheck (healthcheck_config: null) yet are always usable — so
      // they'd never surface here under the health gate. Treat them as
      // healthy so they're attachable/scopable (e.g. the Local Database can
      // be picked + table-scoped like any external DB connector).
      if (cred.healthcheck_last_success !== true && !connector.is_builtin) continue;

      seen.add(cred.service_type);
      healthy.push({
        name: connector.name,
        meta: getConnectorMeta(connector.name),
        credentialId: cred.id,
        category: connector.category,
      });
    }

    return healthy;
  }, [credentials, connectorDefinitions]);
}
