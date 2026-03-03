import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Table2, Code2, Terminal } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
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
  const fetchDbSchemaTables = usePersonaStore((s) => s.fetchDbSchemaTables);
  const fetchDbSavedQueries = usePersonaStore((s) => s.fetchDbSavedQueries);

  // Load data on mount
  useEffect(() => {
    fetchDbSchemaTables(credential.id);
    fetchDbSavedQueries(credential.id);
  }, [credential.id, fetchDbSchemaTables, fetchDbSavedQueries]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const iconUrl = connector?.icon_url;
  const color = connector?.color || '#6B7280';

  // Determine query language based on connector type
  const queryLanguage = getQueryLanguage(credential.service_type);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="relative w-full max-w-6xl h-[90vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20 shrink-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center border border-primary/15"
              style={{ backgroundColor: `${color}15` }}
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" className="w-5 h-5 object-contain" />
              ) : (
                <div className="w-5 h-5 rounded" style={{ backgroundColor: color }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-foreground/90 truncate">
                {credential.name}
              </h2>
              <p className="text-xs text-muted-foreground/60">
                Schema Manager — {connector?.label || credential.service_type}
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
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
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

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeTab === 'tables' && (
              <TablesTab credentialId={credential.id} />
            )}
            {activeTab === 'queries' && (
              <QueriesTab credentialId={credential.id} language={queryLanguage} />
            )}
            {activeTab === 'console' && (
              <ConsoleTab credentialId={credential.id} language={queryLanguage} />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function getQueryLanguage(serviceType: string): string {
  switch (serviceType) {
    case 'upstash':
    case 'redis':
      return 'redis';
    case 'mongodb':
      return 'mongodb';
    default:
      return 'sql';
  }
}
