import { useState, useMemo, useCallback, useEffect } from 'react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import {
  type HealthFilter,
  type SortKey,
  type GroupedCredentials,
  collectAllTags,
  filterAndSortCredentials,
  groupCredentials,
} from './credentialListTypes';

export function useCredentialListFilters(
  credentials: CredentialMetadata[],
  connectorDefinitions: ConnectorDefinition[],
  searchTerm?: string,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [openDropdown, setOpenDropdown] = useState<'health' | 'sort' | null>(null);

  const allTags = useMemo(() => collectAllTags(credentials), [credentials]);
  const hasFilters = selectedTags.length > 0 || healthFilter !== 'all';

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

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setHealthFilter('all');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    () => filterAndSortCredentials(credentials, searchTerm, selectedTags, healthFilter, sortKey, getConnectorForType),
    [credentials, searchTerm, selectedTags, healthFilter, sortKey, getConnectorForType],
  );

  const selectedCredential = selectedId ? credentials.find((c) => c.id === selectedId) : undefined;
  const selectedConnector = selectedCredential ? getConnectorForType(selectedCredential.service_type) : undefined;
  const selectedIsDatabase = selectedConnector?.category === 'database';

  const grouped: GroupedCredentials[] = useMemo(
    () => groupCredentials(filteredCredentials, sortKey, getConnectorForType),
    [filteredCredentials, sortKey, getConnectorForType],
  );

  const showFilterBar = credentials.length > 0 && (allTags.length > 0 || credentials.length > 3);

  return {
    selectedId, setSelectedId,
    selectedTags, selectedCredential, selectedConnector, selectedIsDatabase,
    healthFilter, setHealthFilter,
    sortKey, setSortKey,
    openDropdown, setOpenDropdown,
    allTags, hasFilters,
    toggleTag, clearFilters,
    filteredCredentials, grouped,
    showFilterBar,
    getConnectorForType,
  };
}
