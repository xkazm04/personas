import { useState, useMemo, useCallback } from 'react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import {
  type HealthFilter,
  type SortKey,
  filterAndSortCredentials,
} from './credentialListTypes';

export function useCredentialListFilters(
  credentials: CredentialMetadata[],
  connectorDefinitions: ConnectorDefinition[],
  searchTerm?: string,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const connectorMap = useMemo(() => {
    const map = new Map<string, ConnectorDefinition>();
    for (const connector of connectorDefinitions) {
      map.set(connector.name, connector);
    }
    return map;
  }, [connectorDefinitions]);

  const googleFallbackConnector = useMemo(
    () => connectorDefinitions.find((c) => {
      const metadata = (c.metadata ?? {}) as Record<string, unknown>;
      return metadata.oauth_type === 'google' || c.name === 'google_workspace_oauth_template';
    }),
    [connectorDefinitions],
  );

  const getConnectorForType = useCallback((type: string): ConnectorDefinition | undefined => {
    const exact = connectorMap.get(type);
    if (exact) return exact;

    const normalizedType = type.toLowerCase();
    if (
      normalizedType.includes('google')
      || normalizedType === 'gmail'
      || normalizedType === 'google_calendar'
      || normalizedType === 'google_drive'
    ) {
      return googleFallbackConnector;
    }

    return undefined;
  }, [connectorMap, googleFallbackConnector]);

  const filteredCredentials = useMemo(
    () => filterAndSortCredentials(
      credentials,
      { searchTerm, healthFilter, categoryFilter, sortKey, sortDirection },
      getConnectorForType,
    ),
    [credentials, searchTerm, healthFilter, categoryFilter, sortKey, sortDirection, getConnectorForType],
  );

  const selectedCredential = selectedId ? credentials.find((c) => c.id === selectedId) : undefined;
  const selectedConnector = selectedCredential ? getConnectorForType(selectedCredential.service_type) : undefined;
  const selectedIsDatabase = selectedConnector?.category === 'database';

  return {
    setSelectedId,
    selectedCredential, selectedConnector, selectedIsDatabase,
    healthFilter, setHealthFilter,
    categoryFilter, setCategoryFilter,
    sortKey, setSortKey,
    sortDirection, setSortDirection,
    filteredCredentials,
    getConnectorForType,
  };
}
