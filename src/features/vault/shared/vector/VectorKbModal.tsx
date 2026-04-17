import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { createLogger } from '@/lib/log';

const logger = createLogger('vector-kb-modal');
import { X, FileText, Search, Settings, Brain, Pencil, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toCredentialMetadata } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import * as credApi from '@/api/vault/credentials';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { KnowledgeBase } from '@/api/vault/database/vectorKb';
import { getKnowledgeBase } from '@/api/vault/database/vectorKb';
import { BaseModal } from '@/lib/ui/BaseModal';
import { DocumentsTab } from './tabs/DocumentsTab';
import { SearchTab } from './tabs/SearchTab';
import { SettingsTab } from './tabs/SettingsTab';

type VectorTab = 'documents' | 'search' | 'settings';

const TABS: { id: VectorTab; label: string; icon: typeof FileText }[] = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface VectorKbModalProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
}

export function VectorKbModal({ credential, connector, onClose }: VectorKbModalProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [activeTab, setActiveTab] = useState<VectorTab>('documents');
  const [visited, setVisited] = useState<Set<VectorTab>>(() => new Set(['documents']));
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract kb_id from credential metadata
  const kbId = extractKbId(credential);

  const refreshKb = useCallback(async () => {
    if (!kbId) return;
    try {
      const data = await getKnowledgeBase(kbId);
      setKb(data);
    } catch (err) {
      logger.error('Failed to load knowledge base', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    if (!kbId) {
      setLoading(false);
      return;
    }
    void refreshKb();
  }, [refreshKb, kbId]);

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

  const color = connector?.color || '#8B5CF6';

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="vector-kb-title"
      size="6xl"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden h-[90vh]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20 shrink-0">
        <div
          className="w-9 h-9 rounded-card flex items-center justify-center border border-primary/15"
          style={{ backgroundColor: `${color}15` }}
        >
          <Brain className="w-5 h-5" style={{ color }} />
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
                  className="flex-1 min-w-0 typo-heading font-semibold text-foreground/90 bg-background/50 border border-primary/20 rounded-input px-2 py-0.5 focus-visible:outline-none focus-visible:border-primary/40"
                />
                <button
                  onMouseDown={(e) => { e.preventDefault(); saveName(); }}
                  className="p-0.5 rounded text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
                  title={sh.save_name}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <h2 id="vector-kb-title" className="typo-heading font-semibold text-foreground/90 truncate">
                  {kb?.name || credential.name}
                </h2>
                <button
                  onClick={() => { setEditName(credential.name); setIsEditingName(true); }}
                  className="p-0.5 rounded text-foreground hover:text-muted-foreground/70 opacity-0 group-hover/name:opacity-100 transition-all shrink-0"
                  title={sh.rename_credential}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
          <p className="typo-body text-foreground">
            {sh.vector_kb}
            {kb && (
              <span className="ml-2 typo-caption">
                -- {kb.documentCount} docs, {kb.chunkCount} chunks
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
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
              className={`relative flex items-center gap-1.5 px-4 py-2.5 typo-body font-medium transition-colors ${
                isActive
                  ? 'text-foreground/90'
                  : 'text-foreground hover:text-muted-foreground/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="vectorKbTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500/60 rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
          </div>
        )}

        {!loading && kb && (
          <>
            {visited.has('documents') && (
              <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'documents' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                <DocumentsTab kb={kb} onRefresh={refreshKb} />
              </div>
            )}
            {visited.has('search') && (
              <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'search' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                <SearchTab kb={kb} />
              </div>
            )}
            {visited.has('settings') && (
              <div className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${activeTab === 'settings' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                <SettingsTab kb={kb} />
              </div>
            )}
          </>
        )}

        {!loading && !kb && (
          <div className="absolute inset-0 flex items-center justify-center text-center p-8">
            <div>
              <Brain className="w-10 h-10 text-violet-400/30 mx-auto mb-3" />
              <p className="typo-body text-foreground">{sh.kb_not_found}</p>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
}

function extractKbId(credential: CredentialMetadata): string | null {
  try {
    const meta = typeof credential.metadata === 'string'
      ? JSON.parse(credential.metadata)
      : credential.metadata;
    return meta?.kb_id || null;
  } catch {
    return null;
  }
}
