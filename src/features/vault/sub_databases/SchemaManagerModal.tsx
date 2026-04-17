import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Table2, Code2, Terminal, MessageSquare, Pencil, Check } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { toCredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
import * as credApi from '@/api/vault/credentials';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { TablesTab } from './tabs/TablesTab';
import { QueriesTab } from './tabs/QueriesTab';
import { ConsoleTab } from './tabs/ConsoleTab';
import { ChatTab } from './tabs/ChatTab';

type SchemaTab = 'chat' | 'tables' | 'queries' | 'console';

const TAB_ICONS: Record<SchemaTab, typeof Table2> = {
  tables: Table2,
  queries: Code2,
  console: Terminal,
  chat: MessageSquare,
};
const TAB_ORDER: SchemaTab[] = ['tables', 'queries', 'console', 'chat'];

interface SchemaManagerModalProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
}

export function SchemaManagerModal({ credential, connector, onClose }: SchemaManagerModalProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  const TAB_LABELS: Record<SchemaTab, string> = {
    tables: db.tab_tables,
    queries: db.tab_queries,
    console: db.tab_console,
    chat: db.tab_chat,
  };
  const [activeTab, setActiveTab] = useState<SchemaTab>('tables');
  // Track which tabs have been visited -- mount lazily, keep mounted
  const [visited, setVisited] = useState<Set<SchemaTab>>(() => new Set(['tables']));
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(credential.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const saveName = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === credential.name) {
      setIsEditingName(false);
      setEditName(credential.name);
      return;
    }
    try {
      const updatedRaw = await credApi.updateCredential(credential.id, {
        name: trimmed,
        service_type: null,
        encrypted_data: null,
        metadata: null,
      });
      const updated = toCredentialMetadata(updatedRaw);
      useVaultStore.setState((s) => ({
        credentials: s.credentials.map((c) => (c.id === credential.id ? updated : c)),
      }));
    } catch { /* intentional: non-critical -- rename is best-effort */ }
    setIsEditingName(false);
  }, [credential.id, credential.name, editName]);

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
    <BaseModal isOpen onClose={onClose} titleId="schema-manager-title" size="6xl" portal panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden h-[90vh]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20 shrink-0">
        <div
          className="w-9 h-9 rounded-card flex items-center justify-center border border-primary/15"
          style={{ backgroundColor: `${color}15` }}
        >
          {iconUrl ? (
            <ThemedConnectorIcon url={iconUrl} label={credential.name} color={color} size="w-5 h-5" />
          ) : (
            <div className="w-5 h-5 rounded" style={{ backgroundColor: color }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 group/name">
            {isEditingName ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') { setIsEditingName(false); setEditName(credential.name); }
                  }}
                  onBlur={saveName}
                  autoFocus
                  className="flex-1 min-w-0 text-sm font-semibold text-foreground/90 bg-background/50 border border-primary/20 rounded-input px-2 py-0.5 focus-visible:outline-none focus-visible:border-primary/40"
                />
                <button
                  onMouseDown={(e) => { e.preventDefault(); saveName(); }}
                  className="p-0.5 rounded text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
                  title={db.save_name}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <h2 id="schema-manager-title" className="text-sm font-semibold text-foreground/90 truncate">
                  {credential.name}
                </h2>
                <button
                  onClick={() => { setEditName(credential.name); setIsEditingName(true); }}
                  className="p-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground/70 opacity-0 group-hover/name:opacity-100 transition-all shrink-0"
                  title={db.rename_credential}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground/60">
            {db.schema_manager} -- {connector?.label || credential.service_type}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-card hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-primary/10 shrink-0">
        {TAB_ORDER.map((tabId) => {
          const Icon = TAB_ICONS[tabId];
          const isActive = tabId === activeTab;
          return (
            <button
              key={tabId}
              onClick={() => { setVisited((prev) => new Set([...prev, tabId])); setActiveTab(tabId); }}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-foreground/90'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {TAB_LABELS[tabId]}
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
        {visited.has('chat') && (
          <div className={`absolute inset-0 transition-opacity duration-150 ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <ChatTab credentialId={credential.id} language={queryLanguage} serviceType={credential.service_type} />
          </div>
        )}
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
    case 'notion':
      return 'notion';
    case 'airtable':
      return 'airtable';
    default:
      return 'sql';
  }
}
