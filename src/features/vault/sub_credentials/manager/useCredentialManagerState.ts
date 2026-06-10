import { useState, useEffect, useCallback, useRef } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useUndoDelete } from '@/features/vault/shared/hooks/useUndoDelete';
import { useCredentialViewFSM } from '@/features/vault/shared/hooks/useCredentialViewFSM';
import { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import { IS_DESKTOP } from '@/lib/utils/platform/platform';
import { useRotateAll } from './useRotateAll';
import { useCatalogHandlers } from './useCatalogHandlers';


export function useCredentialManagerState() {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);
  const createCredential = useVaultStore((s) => s.createCredential);
  const deleteCredential = useVaultStore((s) => s.deleteCredential);
  const globalError = useSystemStore((s) => s.error);
  const setGlobalError = useSystemStore((s) => s.setError);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bannerError = error ?? globalError;

  const [credentialSearch, setCredentialSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Manual "Test all" runner. The automated daily healthcheck now runs
  // in-process in the engine (CredentialHealthcheckSubscription); there is no
  // longer a per-visit frontend auto-test. The old auto-test fired ~24
  // concurrent privileged `healthcheck_credential` IPC calls and raced the
  // `x-ipc-token` injection, surfacing valid credentials as false "degraded".
  const bulk = useBulkHealthcheck();

  const { state: viewState, dispatch, filteredConnectors, catalogFormData, breadcrumbs } = useCredentialViewFSM(connectorDefinitions);

  // Rotation
  const { isRotatingAll, rotateAllResult, rotatableCount, handleRotateAll } = useRotateAll({
    credentials,
    connectorDefinitions,
    fetchCredentials,
  });

  // Catalog / OAuth handlers
  const catalog = useCatalogHandlers({
    viewState,
    dispatch,
    catalogFormData,
    credentialSearch,
    setCredentialSearch,
    setError,
    createCredential,
    fetchCredentials,
  });

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

  const undoDelete = useUndoDelete({
    onDelete: deleteCredential,
    onError: (message) => setError(message),
  });

  const handleDeleteRequest = useCallback(async (credentialId: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (!cred) return;
    undoDelete.requestDelete(cred);
  }, [credentials, undoDelete]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      setLoading(false);
    };
    init();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  return {
    // Data
    credentials,
    connectorDefinitions,
    loading,
    bannerError,
    setError,
    setGlobalError,
    credentialSearch,
    setCredentialSearch,
    searchInputRef,
    isRotatingAll,
    rotateAllResult,
    rotatableCount,
    bulk,
    // FSM
    viewState,
    dispatch,
    filteredConnectors,
    catalogFormData,
    breadcrumbs,
    // Catalog / OAuth
    ...catalog,
    // Handlers
    handleRotateAll,
    handleDeleteRequest,
    // Undo
    undoDelete,
    // Re-exports
    fetchCredentials,
    fetchConnectorDefinitions,
    IS_DESKTOP,
  };
}
