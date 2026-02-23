import { useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Search, Key, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { CredentialList } from '@/features/vault/components/CredentialList';
import { CredentialPicker } from '@/features/vault/components/CredentialPicker';
import { CredentialDesignModal } from '@/features/vault/components/CredentialDesignModal';
import { CredentialTemplateForm } from '@/features/vault/components/CredentialTemplateForm';
import { CredentialDeleteDialog } from '@/features/vault/components/CredentialDeleteDialog';
import { VaultStatusBadge } from '@/features/vault/components/VaultStatusBadge';
import { useCredentialOAuth } from '@/features/vault/hooks/useCredentialOAuth';
import { useUndoDelete } from '@/features/vault/hooks/useUndoDelete';
import { useTemplateSelection } from '@/features/vault/hooks/useTemplateSelection';
import * as api from '@/api/tauriApi';
import type { VaultStatus } from '@/api/tauriApi';

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
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialSearch, setCredentialSearch] = useState('');

  const template = useTemplateSelection(connectorDefinitions);

  const handleOAuthSuccess = useCallback(async ({ credentialData }: { credentialData: Record<string, string> }) => {
    if (!template.selectedConnector) return;
    const name = template.credentialName.trim() || `${template.selectedConnector.label} Credential`;
    await createCredential({
      name,
      service_type: template.selectedConnector.name,
      data: credentialData,
    });
    await fetchCredentials();
    setCredentialView('credentials');
    template.resetAll();
    setCredentialSearch('');
  }, [template.selectedConnector, template.credentialName, createCredential, fetchCredentials, setCredentialView, template.resetAll]);

  const handleOAuthError = useCallback((message: string) => {
    setError(message);
  }, []);

  const oauth = useCredentialOAuth({
    onSuccess: handleOAuthSuccess,
    onError: handleOAuthError,
  });

  const undoDelete = useUndoDelete({
    onDelete: deleteCredential,
    onError: (message) => setError(message),
  });

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

  const handleCreateCredential = async (values: Record<string, string>) => {
    if (!template.selectedConnector) return;

    const name = template.credentialName.trim() || `${template.selectedConnector.label} Credential`;

    try {
      setError(null);
      await createCredential({
        name,
        service_type: template.selectedConnector.name,
        data: values,
      });
      await fetchCredentials();
      setCredentialView('credentials');
      template.resetAll();
      setCredentialSearch('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create credential');
    }
  };

  const handleDeleteRequest = useCallback(async (credentialId: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (!cred) return;
    undoDelete.requestDelete(cred);
  }, [credentials, undoDelete.requestDelete]);

  const handleTemplateOAuthConsent = (values: Record<string, string>) => {
    if (!template.selectedConnector) return;
    setError(null);
    oauth.startConsent(template.selectedConnector.name, values);
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Key className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title="Credentials"
        subtitle={`${credentials.length} credential${credentials.length !== 1 ? 's' : ''} stored`}
        actions={vault ? <VaultStatusBadge vault={vault} onVaultRefresh={setVault} /> : undefined}
      />

      <ContentBody>

      {credentialView === 'credentials' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
          <input
            type="text"
            value={credentialSearch}
            onChange={(e) => setCredentialSearch(e.target.value)}
            placeholder="Search credentials by name, type, or connector"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {credentialView === 'from-template' && template.templateMode === 'pick-type' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
          <input
            type="text"
            value={template.templateSearch}
            onChange={(e) => template.setTemplateSearch(e.target.value)}
            placeholder="Search catalog by label, type, or category"
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
            className="text-red-400/60 hover:text-red-400 text-sm font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {credentialView === 'from-template' && template.templateMode === 'pick-type' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CredentialPicker
              connectors={template.filteredConnectors}
              onPickType={template.pickType}
            />
          </motion.div>
        )}

        {credentialView === 'from-template' && template.templateMode === 'add-form' && template.selectedConnector && (
          <CredentialTemplateForm
            selectedConnector={template.selectedConnector}
            credentialName={template.credentialName}
            onCredentialNameChange={template.setCredentialName}
            effectiveTemplateFields={template.effectiveTemplateFields}
            isGoogleTemplate={template.isGoogleTemplate}
            isAuthorizingOAuth={oauth.isAuthorizing}
            oauthCompletedAt={oauth.completedAt}
            onCreateCredential={handleCreateCredential}
            onOAuthConsent={handleTemplateOAuthConsent}
            onCancel={() => {
              template.cancelForm();
              oauth.reset();
            }}
            onValuesChanged={() => {
              if (oauth.completedAt) oauth.reset();
            }}
          />
        )}

        {credentialView === 'credentials' && (
          <CredentialList
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            searchTerm={credentialSearch}
            onDelete={handleDeleteRequest}
            onQuickStart={(connector) => {
              setCredentialView('from-template');
              template.pickType(connector);
            }}
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
                void fetchCredentials().catch(() => {});
                fetchConnectorDefinitions();
                setCredentialView('credentials');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <CredentialDeleteDialog
        deleteConfirm={undoDelete.deleteConfirm}
        onConfirmDelete={undoDelete.confirmDelete}
        onCancelDelete={undoDelete.cancelDelete}
        undoToast={undoDelete.undoToast}
        onUndo={undoDelete.undo}
      />
      </ContentBody>
    </ContentBox>
  );
}
