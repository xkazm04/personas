import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Table2, Code2, Terminal } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useVaultStore } from "@/stores/vaultStore";
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { TablesTab } from './tabs/TablesTab';
import { QueriesTab } from './tabs/QueriesTab';
import { ConsoleTab } from './tabs/ConsoleTab';

type SchemaTab = 'tables' | 'queries' | 'console';

const TABS: { id: SchemaTab; label: string; icon: typeof Table2 }[] = [
  { id: 'tables', label: 'Tables', icon: Table2 },
  { id: 'queries', label: 'Queries', icon: Code2 },
  { id: 'console', label: 'Console', icon: Terminal },
];

interface SchemaManagerModalProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
}

export function SchemaManagerModal({ credential, connector, onClose }: SchemaManagerModalProps) {
  const [activeTab, setActiveTab] = useState<SchemaTab>('tables');
  // Track which tabs have been visited -- mount lazily, keep mounted
  const [visited, setVisited] = useState<Set<SchemaTab>>(() => new Set(['tables']));
  const fetchDbSchemaTables = useVaultStore((s) => s.fetchDbSchemaTables);
  const fetchDbSavedQueries = useVaultStore((s) => s.fetchDbSavedQueries);

  // Load data on mount
  useEffect(() => {
    fetchDbSchemaTables(credential.id);
    fetchDbSavedQueries(credential.id);
  }, [credential.id, fetchDbSchemaTables, fetchDbSavedQueries]);

  const iconUrl = connector?.icon_url;
  const color = connector?.color || '#6B7280';

  // Determine query language based on connector type
  const queryLanguage = getQueryLanguage(credential.service_type);

  return (
    <BaseModal isOpen onClose={onClose} titleId="schema-manager-title" size="6xl" panelClassName="bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden h-[90vh]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20 shrink-0">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-primary/15"
          style={{ backgroundColor: `${color}15` }}
        >
          {iconUrl ? (
            <ThemedConnectorIcon url={iconUrl} label={credential.name} color={color} size="w-5 h-5" />
          ) : (
            <div className="w-5 h-5 rounded" style={{ backgroundColor: color }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="schema-manager-title" className="text-sm font-semibold text-foreground/90 truncate">
            {credential.name}
          </h2>
          <p className="text-sm text-muted-foreground/60">
            Schema Manager -- {connector?.label || credential.service_type}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-primary/10 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => { setVisited((prev) => new Set([...prev, tab.id])); setActiveTab(tab.id); }}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-foreground/90'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="schemaManagerTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/60 rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content -- lazy mount on first visit, keep mounted to preserve state */}
      <div className="flex-1 min-h-0 relative">
        {visited.has('tables') && (
          <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'tables' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <TablesTab credentialId={credential.id} serviceType={credential.service_type} />
          </div>
        )}
        {visited.has('queries') && (
          <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'queries' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <QueriesTab credentialId={credential.id} language={queryLanguage} serviceType={credential.service_type} />
          </div>
        )}
        {visited.has('console') && (
          <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'console' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <ConsoleTab credentialId={credential.id} language={queryLanguage} />
          </div>
        )}
      </div>
    </BaseModal>
  );
}

function getQueryLanguage(serviceType: string): string {
  switch (serviceType) {
    case 'upstash':
    case 'redis':
      return 'redis';
    case 'mongodb':
      return 'mongodb';
    case 'convex':
      return 'convex';
    default:
      return 'sql';
  }
}
