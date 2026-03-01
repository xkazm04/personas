import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Search, Key, XCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { CredentialList } from '@/features/vault/components/CredentialList';
import { CredentialPicker } from '@/features/vault/components/CredentialPicker';
import { CredentialDesignModal } from '@/features/vault/components/CredentialDesignModal';
import { CredentialTemplateForm } from '@/features/vault/components/CredentialTemplateForm';
import { CredentialTypePicker } from '@/features/vault/components/CredentialTypePicker';
import { CredentialSchemaForm, MCP_SCHEMA, CUSTOM_SCHEMA, DATABASE_SCHEMA } from '@/features/vault/components/credential-types/CredentialSchemaForm';
import { CredentialDeleteDialog } from '@/features/vault/components/CredentialDeleteDialog';
import { VaultStatusBadge } from '@/features/vault/components/VaultStatusBadge';
import { useCredentialOAuth } from '@/features/vault/hooks/useCredentialOAuth';
import { useUndoDelete } from '@/features/vault/hooks/useUndoDelete';
import { useCredentialViewFSM, type CredentialNavKey } from '@/features/vault/hooks/useCredentialViewFSM';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import type { ConnectorDefinition } from '@/lib/types/types';
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { state: viewState, dispatch, navKey, navigateFromSidebar, filteredConnectors, catalogFormData } = useCredentialViewFSM(connectorDefinitions);

  // Sync unified search to FSM when in catalog view
  useEffect(() => {
    if (viewState.view === 'catalog-browse') {
      dispatch({ type: 'SET_CATALOG_SEARCH', search: credentialSearch });
    }
  }, [credentialSearch, viewState.view, dispatch]);

  // Cmd/Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Bidirectional sync: FSM <-> Zustand ──
  // External navigation (Sidebar, ToolSelector, DesignModal) writes to Zustand; FSM reacts.
  useEffect(() => {
    const target: CredentialNavKey =
      credentialView === 'credentials' ? 'credentials' :
      credentialView === 'from-template' ? 'from-template' :
      'add-new';
    if (target !== navKey) {
      navigateFromSidebar(target);
    }
  }, [credentialView]); // eslint-disable-line react-hooks/exhaustive-deps

  // FSM navKey -> Zustand (for sidebar highlighting)
  useEffect(() => {
    setCredentialView(navKey);
  }, [navKey, setCredentialView]);

  // Healthcheck for catalog (from-template) flow
  const selectedConnectorName = viewState.view === 'catalog-form' ? viewState.connector.name : null;
  const templateHealthKey = `preview:${selectedConnectorName ?? '_none'}`;
  const templateHealth = useCredentialHealth(templateHealthKey);

  const handleOAuthSuccess = useCallback(async ({ credentialData }: { credentialData: Record<string, string> }) => {
    if (!catalogFormData) return;
    const name = catalogFormData.credentialName.trim() || `${catalogFormData.connector.label} Credential`;
    await createCredential({
      name,
      service_type: catalogFormData.connector.name,
      data: credentialData,
    });
    await fetchCredentials();
    dispatch({ type: 'GO_LIST' });
    setCredentialSearch('');
  }, [catalogFormData, createCredential, fetchCredentials, dispatch]);

  const handleOAuthError = useCallback((message: string) => {
    setError(message);
  }, []);

  const oauth = useCredentialOAuth({
    onSuccess: handleOAuthSuccess,
    onError: handleOAuthError,
  });

  // Wrap pickType to clear healthcheck state when switching connectors
  const handlePickType = useCallback((connector: ConnectorDefinition) => {
    templateHealth.invalidate();
    oauth.reset();
    dispatch({ type: 'PICK_CONNECTOR', connector });
  }, [dispatch, oauth, templateHealth.invalidate]);

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
    if (!catalogFormData) return;

    const name = catalogFormData.credentialName.trim() || `${catalogFormData.connector.label} Credential`;

    try {
      setError(null);
      await createCredential({
        name,
        service_type: catalogFormData.connector.name,
        data: values,
      });
      await fetchCredentials();
      dispatch({ type: 'GO_LIST' });
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
    if (!catalogFormData) return;
    setError(null);
    oauth.startConsent(catalogFormData.connector.name, values);
  };

  const handleTemplateHealthcheck = async (values: Record<string, string>) => {
    if (!catalogFormData) return;
    await templateHealth.checkPreview(catalogFormData.connector.name, values);
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
      >
        {(viewState.view === 'list' || viewState.view === 'catalog-browse') && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
            <input
              ref={searchInputRef}
              type="text"
              value={credentialSearch}
              onChange={(e) => setCredentialSearch(e.target.value)}
              placeholder={
                viewState.view === 'catalog-browse'
                  ? 'Search catalog by label, type, or category'
                  : 'Search credentials by name, type, or connector'
              }
              className="w-full pl-9 pr-20 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {credentialSearch && (
              <button
                onClick={() => setCredentialSearch('')}
                className="absolute right-12 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded border border-primary/15 bg-secondary/40 text-muted-foreground/40 font-mono pointer-events-none">
              {navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        )}
      </ContentHeader>

      <ContentBody>

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
        {viewState.view === 'catalog-browse' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CredentialPicker
              connectors={filteredConnectors}
              credentials={credentials}
              onPickType={handlePickType}
              searchTerm={credentialSearch}
            />
          </motion.div>
        )}

        {viewState.view === 'catalog-form' && (
          <CredentialTemplateForm
            selectedConnector={viewState.connector}
            credentialName={viewState.credentialName}
            onCredentialNameChange={(name) => dispatch({ type: 'SET_CREDENTIAL_NAME', name })}
            effectiveTemplateFields={catalogFormData!.fields}
            isGoogleTemplate={catalogFormData!.isGoogle}
            isAuthorizingOAuth={oauth.isAuthorizing}
            oauthCompletedAt={oauth.completedAt}
            onCreateCredential={handleCreateCredential}
            onOAuthConsent={handleTemplateOAuthConsent}
            onCancel={() => {
              dispatch({ type: 'CANCEL_FORM' });
              oauth.reset();
              templateHealth.invalidate();
            }}
            onValuesChanged={() => {
              if (oauth.completedAt) oauth.reset();
              if (templateHealth.result) templateHealth.invalidate();
            }}
            onMcpComplete={() => {
              void fetchCredentials().catch(() => {});
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
            }}
            onHealthcheck={handleTemplateHealthcheck}
            isHealthchecking={templateHealth.isHealthchecking}
            healthcheckResult={templateHealth.result}
          />
        )}

        {viewState.view === 'list' && (
          <CredentialList
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            searchTerm={credentialSearch}
            onDelete={handleDeleteRequest}
            onGoToCatalog={() => dispatch({ type: 'GO_CATALOG' })}
            onGoToAddNew={() => dispatch({ type: 'GO_ADD_NEW' })}
            onQuickStart={(connector) => handlePickType(connector)}
          />
        )}

        {viewState.view === 'add-new' && (
          <CredentialTypePicker
            onSelectApiTool={() => dispatch({ type: 'GO_ADD_API_TOOL' })}
            onSelectMcp={() => dispatch({ type: 'GO_ADD_MCP' })}
            onSelectCustom={() => dispatch({ type: 'GO_ADD_CUSTOM' })}
            onSelectDatabase={() => dispatch({ type: 'GO_ADD_DATABASE' })}
            onBack={() => dispatch({ type: 'GO_LIST' })}
          />
        )}

        {viewState.view === 'add-api-tool' && (
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
              onClose={() => dispatch({ type: 'GO_ADD_NEW' })}
              onComplete={() => {
                void fetchCredentials().catch(() => {});
                fetchConnectorDefinitions();
                dispatch({ type: 'GO_LIST' });
              }}
            />
          </motion.div>
        )}

        {viewState.view === 'add-mcp' && (
          <CredentialSchemaForm
            config={MCP_SCHEMA}
            onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
            onComplete={() => dispatch({ type: 'GO_LIST' })}
          />
        )}

        {viewState.view === 'add-custom' && (
          <CredentialSchemaForm
            config={CUSTOM_SCHEMA}
            onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
            onComplete={() => dispatch({ type: 'GO_LIST' })}
          />
        )}

        {viewState.view === 'add-database' && (
          <CredentialSchemaForm
            config={DATABASE_SCHEMA}
            onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
            onComplete={() => dispatch({ type: 'GO_LIST' })}
          />
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
