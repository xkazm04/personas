import { useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plus, Plug, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from './CredentialEditForm';
import { CredentialList } from './CredentialList';
import { CredentialPicker } from './CredentialPicker';
import { VaultStatusBadge } from './VaultStatusBadge';
import type { ConnectorDefinition } from '@/lib/types/types';
import * as api from '@/api/tauriApi';
import type { VaultStatus } from '@/api/tauriApi';

type ViewMode = 'list' | 'pick-type' | 'add-form';

export function CredentialManager() {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const createCredential = usePersonaStore((s) => s.createCredential);
  const deleteCredential = usePersonaStore((s) => s.deleteCredential);

  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null);
  const [credentialName, setCredentialName] = useState('');
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setCredentialName('');
    setViewMode('add-form');
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
      setViewMode('list');
      setSelectedConnector(null);
      setCredentialName('');
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
  const groupedConnectors = connectorDefinitions.reduce<Record<string, ConnectorDefinition[]>>(
    (acc, c) => {
      const cat = c.category || 'general';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(c);
      return acc;
    },
    {}
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Credentials</h3>
          {vault && <VaultStatusBadge vault={vault} />}
        </div>
        {viewMode === 'list' && (
          <button
            onClick={() => setViewMode('pick-type')}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4" />
            Add Credential
          </button>
        )}
        {viewMode !== 'list' && (
          <button
            onClick={() => { setViewMode('list'); setSelectedConnector(null); }}
            className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
          >
            Back to List
          </button>
        )}
      </div>

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
        {viewMode === 'pick-type' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CredentialPicker
              groupedConnectors={groupedConnectors}
              onPickType={handlePickType}
            />
          </motion.div>
        )}

        {viewMode === 'add-form' && selectedConnector && (
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
              onCancel={() => { setViewMode('list'); setSelectedConnector(null); }}
            />
          </motion.div>
        )}

        {viewMode === 'list' && (
          <CredentialList
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
