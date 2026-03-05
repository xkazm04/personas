import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Search, Key, X, RotateCw, Loader2, CheckCircle2, HeartPulse } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { VaultErrorBanner } from '@/features/vault/sub_card/VaultErrorBanner';
import { CredentialList } from '@/features/vault/sub_list/CredentialList';
import { CredentialPicker } from '@/features/vault/sub_list/CredentialPicker';
import { CredentialDesignModal } from '@/features/vault/sub_design/CredentialDesignModal';
import { CredentialTemplateForm } from '@/features/vault/sub_forms/CredentialTemplateForm';
import { CredentialTypePicker } from '@/features/vault/sub_forms/CredentialTypePicker';
import { CredentialSchemaForm, MCP_SCHEMA, CUSTOM_SCHEMA, DATABASE_SCHEMA } from '@/features/vault/sub_schemas/CredentialSchemaForm';
import { CredentialDeleteDialog } from '@/features/vault/sub_card/CredentialDeleteDialog';
import { VaultStatusBadge } from '@/features/vault/sub_card/VaultStatusBadge';
import { CatalogAutoSetup } from '@/features/vault/sub_autoCred/CatalogAutoSetup';
import { ForagingPanel } from '@/features/vault/sub_foraging/ForagingPanel';
import { DatabaseListView } from '@/features/vault/sub_databases/DatabaseListView';
import { BulkHealthcheckSummary } from '@/features/vault/sub_manager/BulkHealthcheckSummary';
import { useCredentialOAuth } from '@/features/vault/hooks/useCredentialOAuth';
import { useUndoDelete } from '@/features/vault/hooks/useUndoDelete';
import { useCredentialViewFSM } from '@/features/vault/hooks/useCredentialViewFSM';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { useBulkHealthcheck } from '@/features/vault/hooks/useBulkHealthcheck';
import type { ConnectorDefinition } from '@/lib/types/types';
import * as api from '@/api/tauriApi';
import type { VaultStatus } from '@/api/tauriApi';
import { getRotationStatus, rotateCredentialNow } from '@/api/rotation';

export function CredentialManager() {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const createCredential = usePersonaStore((s) => s.createCredential);
  const deleteCredential = usePersonaStore((s) => s.deleteCredential);
  const globalError = usePersonaStore((s) => s.error);
  const setGlobalError = usePersonaStore((s) => s.setError);

  const [loading, setLoading] = useState(true);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bannerError = error ?? globalError;

  const [credentialSearch, setCredentialSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Rotate All state
  const [isRotatingAll, setIsRotatingAll] = useState(false);
  const [rotateAllResult, setRotateAllResult] = useState<{ rotated: number; failed: number } | null>(null);

  // Bulk Healthcheck
  const bulk = useBulkHealthcheck();

  const { state: viewState, dispatch, filteredConnectors, catalogFormData } = useCredentialViewFSM(connectorDefinitions);

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

  // Healthcheck for catalog (from-template) flow.
  // Preview mode manages ephemeral key lifecycle internally.
  const templateHealth = useCredentialHealth({
    mode: 'preview',
    serviceType: viewState.view === 'catalog-form' ? viewState.connector.name : null,
  });

  const handleOAuthSuccess = useCallback(async ({ credentialData }: { credentialData: Record<string, string> }) => {
    if (!catalogFormData) return;
    const name = catalogFormData.credentialName.trim() || `${catalogFormData.connector.label} Credential`;
    try {
      await createCredential({
        name,
        service_type: catalogFormData.connector.name,
        data: credentialData,
      });
      await fetchCredentials();
      dispatch({ type: 'GO_LIST' });
      setCredentialSearch('');
    } catch {
      setError('Failed to save OAuth credential');
    }
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
    oauth.reset();
    dispatch({ type: 'PICK_CONNECTOR', connector, parentSearch: credentialSearch });
  }, [credentialSearch, dispatch, oauth]);

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

    setError(null);
    try {
      await createCredential({
        name,
        service_type: catalogFormData.connector.name,
        data: values,
      });
      await fetchCredentials();
      dispatch({ type: 'GO_LIST' });
      setCredentialSearch('');
    } catch {
      setError('Failed to create credential');
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

  const handleAutoSetup = useCallback(() => {
    if (!catalogFormData) return;
    dispatch({ type: 'GO_AUTO_SETUP', connector: catalogFormData.connector });
  }, [catalogFormData, dispatch]);

  const handleRotateAll = useCallback(async () => {
    setIsRotatingAll(true);
    setRotateAllResult(null);
    let rotated = 0;
    let failed = 0;

    // Check rotation status for each credential and rotate those with active policies
    const rotatable: string[] = [];
    await Promise.all(
      credentials.map(async (cred) => {
        try {
          const status = await getRotationStatus(cred.id);
          if (status.has_policy && status.policy_enabled) {
            rotatable.push(cred.id);
          }
        } catch {
          // skip credentials without rotation
        }
      }),
    );

    // Rotate all eligible credentials
    for (const credId of rotatable) {
      try {
        await rotateCredentialNow(credId);
        rotated++;
      } catch {
        failed++;
      }
    }

    setRotateAllResult({ rotated, failed });
    setIsRotatingAll(false);
    // Refresh credentials to pick up new rotation status
    void fetchCredentials();
    // Clear result after 4s
    setTimeout(() => setRotateAllResult(null), 4000);
  }, [credentials, fetchCredentials]);

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
        actions={
          <div className="flex items-center gap-2">
            {credentials.length > 0 && (
              <button
                onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
                disabled={false}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  bulk.isRunning
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : bulk.summary
                      ? bulk.summary.failed > 0
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'border-violet-500/20 text-violet-400/80 hover:bg-violet-500/10 hover:text-violet-400'
                }`}
                title={bulk.isRunning ? 'Cancel healthcheck' : 'Test all credentials'}
              >
                {bulk.isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : bulk.summary ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <HeartPulse className="w-3 h-3" />
                )}
                {bulk.isRunning
                  ? `Testing ${bulk.progress.done}/${bulk.progress.total}...`
                  : bulk.summary
                    ? `${bulk.summary.passed} passed${bulk.summary.failed > 0 ? `, ${bulk.summary.failed} failed` : ''}`
                    : 'Test All'}
              </button>
            )}
            {credentials.length > 0 && (
              <button
                onClick={handleRotateAll}
                disabled={isRotatingAll}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  rotateAllResult
                    ? rotateAllResult.failed > 0
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'border-cyan-500/20 text-cyan-400/80 hover:bg-cyan-500/10 hover:text-cyan-400'
                }`}
                title="Rotate all credentials with active rotation policies"
              >
                {isRotatingAll ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : rotateAllResult ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <RotateCw className="w-3 h-3" />
                )}
                {isRotatingAll
                  ? 'Rotating...'
                  : rotateAllResult
                    ? `${rotateAllResult.rotated} rotated${rotateAllResult.failed > 0 ? `, ${rotateAllResult.failed} failed` : ''}`
                    : 'Rotate All'}
              </button>
            )}
            {vault && <VaultStatusBadge vault={vault} onVaultRefresh={setVault} />}
          </div>
        }
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
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-sm px-1.5 py-0.5 rounded border border-primary/15 bg-secondary/40 text-muted-foreground/40 font-mono pointer-events-none">
              {navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </div>
        )}
      </ContentHeader>

      <ContentBody>

      {bannerError && (
        <VaultErrorBanner
          message={bannerError}
          onDismiss={() => {
            setError(null);
            setGlobalError(null);
          }}
          variant="banner"
        />
      )}

      <BulkHealthcheckSummary summary={bulk.summary} onDismiss={bulk.dismiss} />

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
            onAutoSetup={handleAutoSetup}
            onBack={() => {
              dispatch({ type: 'CANCEL_FORM' });
              oauth.reset();
              templateHealth.invalidate();
            }}
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

        {viewState.view === 'catalog-auto-setup' && (
          <CatalogAutoSetup
            connector={viewState.connector}
            onComplete={() => {
              void fetchCredentials();
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
              setCredentialSearch('');
            }}
            onCancel={() => dispatch({ type: 'CANCEL_FORM' })}
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
            onForage={() => dispatch({ type: 'GO_FORAGING' })}
            onBack={() => dispatch({ type: 'GO_LIST' })}
          />
        )}

        {viewState.view === 'foraging' && (
          <ForagingPanel
            onComplete={() => {
              void fetchCredentials();
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
            }}
            onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
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

        {viewState.view === 'databases' && (
          <DatabaseListView onBack={() => dispatch({ type: 'GO_LIST' })} />
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
