import { useEffect } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import type { ConnectorInfo } from '@/stores/slices/system/artistSlice';

/** Connector IDs relevant to creative work */
const CREATIVE_CONNECTOR_IDS = [
  { serviceType: 'leonardo_ai', label: 'Leonardo AI' },
  { serviceType: 'gemini', label: 'Gemini AI' },
];

export function useCreativeConnectors() {
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const connectors = useSystemStore((s) => s.creativeConnectors);
  const setCreativeConnectors = useSystemStore((s) => s.setCreativeConnectors);

  useEffect(() => {
    if (!credentials.length) {
      fetchCredentials();
    }
  }, [credentials.length, fetchCredentials]);

  useEffect(() => {
    const infos: ConnectorInfo[] = CREATIVE_CONNECTOR_IDS.map(({ serviceType, label }) => {
      const cred = credentials.find((c) => c.service_type === serviceType);
      return {
        id: serviceType,
        name: label,
        connected: !!cred,
        healthy: cred?.healthcheck_last_success === true,
      };
    });
    setCreativeConnectors(infos);
  }, [credentials, setCreativeConnectors]);

  return connectors;
}
