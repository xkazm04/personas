import { useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plug, XCircle, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from './CredentialEditForm';
import { CredentialList } from './CredentialList';
import { CredentialPicker } from './CredentialPicker';
import { CredentialDesignModal } from './CredentialDesignModal';
import { VaultStatusBadge } from './VaultStatusBadge';
import type { ConnectorDefinition } from '@/lib/types/types';
import * as api from '@/api/tauriApi';
import type { VaultStatus } from '@/api/tauriApi';

type TemplateMode = 'pick-type' | 'add-form';

export function CredentialManager() {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const createCredential = usePersonaStore((s) => s.createCredential);
  const deleteCredential = usePersonaStore((s) => s.deleteCredential);
  const credentialView = usePersonaStore((s) => s.credentialView);
  const setCredentialView = usePersonaStore((s) => s.setCredentialView);

  const [loading, setLoading] = useState(true);
  const [templateMode, setTemplateMode] = useState<TemplateMode>('pick-type');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null);
  const [credentialName, setCredentialName] = useState('');
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialSearch, setCredentialSearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      try {
        const vs = await api.vaultStatus();
        setVault(vs);
      } catch { /* vault status is best-effort */ }
      setLoading(false);
    };
    init();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  const handlePickType = (connector: ConnectorDefinition) => {
    setSelectedConnector(connector);
    setCredentialName(`${connector.label} Credential`);
    setTemplateMode('add-form');
  };

  const handleCreateCredential = async (values: Record<string, string>) => {
    if (!selectedConnector) return;

    const name = credentialName.trim() || `${selectedConnector.label} Credential`;

    try {
      setError(null);
      await createCredential({
        name,
        service_type: selectedConnector.name,
        data: values,
      });
      await fetchCredentials();
      setCredentialView('credentials');
      setSelectedConnector(null);
      setCredentialName('');
      setCredentialSearch('');
      setTemplateSearch('');
      setTemplateMode('pick-type');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create credential');
    }
  };

  const handleDelete = useCallback(async (credentialId: string) => {
    try {
      setError(null);
      await deleteCredential(credentialId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    }
  }, [deleteCredential]);

  // Group connectors by category
  const filteredTemplateConnectors = connectorDefinitions.filter((connector) => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      connector.label.toLowerCase().includes(q)
      || connector.name.toLowerCase().includes(q)
      || connector.category.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Credentials</h3>
          {vault && <VaultStatusBadge vault={vault} />}
        </div>
      </div>

      {credentialView === 'credentials' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={credentialSearch}
            onChange={(e) => setCredentialSearch(e.target.value)}
            placeholder="Search credentials by name, type, or connector"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {credentialView === 'from-template' && templateMode === 'pick-type' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="Search templates by label, type, or category"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 text-xs font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {credentialView === 'from-template' && templateMode === 'pick-type' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CredentialPicker
              connectors={filteredTemplateConnectors}
              onPickType={handlePickType}
            />
          </motion.div>
        )}

        {credentialView === 'from-template' && templateMode === 'add-form' && selectedConnector && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: `${selectedConnector.color}15`,
                  borderColor: `${selectedConnector.color}30`,
                }}
              >
                {selectedConnector.icon_url ? (
                  <img src={selectedConnector.icon_url} alt={selectedConnector.label} className="w-5 h-5" />
                ) : (
                  <Plug className="w-5 h-5" style={{ color: selectedConnector.color }} />
                )}
              </div>
              <div>
                <h4 className="font-medium text-foreground">New {selectedConnector.label} Credential</h4>
                <p className="text-xs text-muted-foreground/40">
                  {selectedConnector.healthcheck_config?.description || 'Configure credential fields'}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Credential Name
              </label>
              <input
                type="text"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder={`My ${selectedConnector.label} Account`}
                className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              />
            </div>

            <CredentialEditForm
              fields={selectedConnector.fields}
              onSave={handleCreateCredential}
              onCancel={() => {
                setTemplateMode('pick-type');
                setSelectedConnector(null);
              }}
            />
          </motion.div>
        )}

        {credentialView === 'credentials' && (
          <CredentialList
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            searchTerm={credentialSearch}
            onDelete={handleDelete}
          />
        )}

        {credentialView === 'add-new' && (
          <motion.div
            key="design-inline"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-secondary/35 border border-primary/15 rounded-2xl p-4"
          >
            <CredentialDesignModal
              open
              embedded
              onClose={() => setCredentialView('credentials')}
              onComplete={() => {
                fetchCredentials();
                fetchConnectorDefinitions();
                setCredentialView('credentials');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
