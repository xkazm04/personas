import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, Search } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { DatabaseCard } from './DatabaseCard';
import { SchemaManagerModal } from './SchemaManagerModal';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DatabaseListViewProps {
  onBack: () => void;
}

export function DatabaseListView({ onBack: _onBack }: DatabaseListViewProps) {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const dbSchemaTables = usePersonaStore((s) => s.dbSchemaTables);
  const dbSavedQueries = usePersonaStore((s) => s.dbSavedQueries);

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<CredentialMetadata | null>(null);

  // Filter to database-category credentials only
  const dbCredentials = useMemo(() => {
    return credentials.filter((c) => {
      const def = connectorDefinitions.find((d) => d.name === c.service_type);
      return def?.category === 'database';
    });
  }, [credentials, connectorDefinitions]);

  // Group by service_type for tabs
  const tabGroups = useMemo(() => {
    const groups = new Map<string, { label: string; connector: ConnectorDefinition | undefined; credentials: CredentialMetadata[] }>();
    for (const cred of dbCredentials) {
      const def = connectorDefinitions.find((d) => d.name === cred.service_type);
      if (!groups.has(cred.service_type)) {
        groups.set(cred.service_type, {
          label: def?.label || cred.service_type,
          connector: def,
          credentials: [],
        });
      }
      groups.get(cred.service_type)!.credentials.push(cred);
    }
    return groups;
  }, [dbCredentials, connectorDefinitions]);

  const tabKeys = useMemo(() => Array.from(tabGroups.keys()), [tabGroups]);

  // Auto-select first tab
  useEffect(() => {
    if (!activeTab && tabKeys.length > 0) {
      setActiveTab(tabKeys[0]!);
    }
  }, [activeTab, tabKeys]);

  // Filtered credentials for active tab
  const visibleCredentials = useMemo(() => {
    if (!activeTab) return dbCredentials;
    const group = tabGroups.get(activeTab);
    if (!group) return [];
    const q = search.trim().toLowerCase();
    if (!q) return group.credentials;
    return group.credentials.filter(
      (c) => c.name.toLowerCase().includes(q) || c.service_type.toLowerCase().includes(q),
    );
  }, [activeTab, tabGroups, search, dbCredentials]);

  const getConnector = (serviceType: string) =>
    connectorDefinitions.find((d) => d.name === serviceType);

  const getTableCount = (credentialId: string) =>
    dbSchemaTables.filter((t) => t.credential_id === credentialId).length;

  const getQueryCount = (credentialId: string) =>
    dbSavedQueries.filter((q) => q.credential_id === credentialId).length;

  if (dbCredentials.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
          <Database className="w-7 h-7 text-blue-400/60" />
        </div>
        <h3 className="text-sm font-medium text-foreground/80 mb-1">No database credentials</h3>
        <p className="text-sm text-muted-foreground/60 max-w-xs">
          Add database credentials from the Catalog to manage schemas and run queries.
        </p>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter databases..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
          />
        </div>

        {/* Tab bar */}
        {tabKeys.length > 1 && (
          <div className="flex items-center gap-1 border-b border-primary/10 pb-px">
            {tabKeys.map((key) => {
              const group = tabGroups.get(key)!;
              const isActive = key === activeTab;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`relative px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                    isActive
                      ? 'text-foreground/90'
                      : 'text-muted-foreground/60 hover:text-muted-foreground/80'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {group.connector?.icon_url ? (
                      <ThemedConnectorIcon url={group.connector.icon_url} label={group.connector.label} color={group.connector.color} size="w-3.5 h-3.5" />
                    ) : null}
                    {group.label}
                    <span className="text-muted-foreground/40">({group.credentials.length})</span>
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="dbTypeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-full"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Credential cards */}
        <div className="space-y-2">
          {visibleCredentials.map((cred) => (
            <DatabaseCard
              key={cred.id}
              credential={cred}
              connector={getConnector(cred.service_type)}
              tableCount={getTableCount(cred.id)}
              queryCount={getQueryCount(cred.id)}
              onClick={() => setSelectedCredential(cred)}
            />
          ))}
          {visibleCredentials.length === 0 && search && (
            <p className="text-sm text-muted-foreground/50 text-center py-6">
              No matching databases
            </p>
          )}
        </div>
      </motion.div>

      {/* Schema Manager Modal */}
      {selectedCredential && (
        <SchemaManagerModal
          credential={selectedCredential}
          connector={getConnector(selectedCredential.service_type)}
          onClose={() => setSelectedCredential(null)}
        />
      )}
    </>
  );
}
