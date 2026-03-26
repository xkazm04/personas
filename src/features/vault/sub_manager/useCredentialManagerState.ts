import { useState, useEffect, useCallback, useRef } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
import { useUndoDelete } from '@/features/vault/hooks/useUndoDelete';
import { useCredentialViewFSM } from '@/features/vault/hooks/useCredentialViewFSM';
import { useBulkHealthcheck } from '@/features/vault/hooks/health/useBulkHealthcheck';
import { vaultStatus } from "@/api/vault/credentials";
import type { VaultStatus } from "@/api/vault/credentials";
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
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bannerError = error ?? globalError;

  const [credentialSearch, setCredentialSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bulk Healthcheck
  const bulk = useBulkHealthcheck();
  const [isDailyRun, setIsDailyRun] = useState(false);

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

  // Sync between provisioning wizard store and FSM view
  const wizardPhase = useProvisioningWizardStore((s) => s.phase);
  useEffect(() => {
    if (wizardPhase !== 'closed' && viewState.view !== 'add-wizard') {
      dispatch({ type: 'GO_ADD_WIZARD' });
    }
  }, [wizardPhase]);

  useEffect(() => {
    if (viewState.view !== 'add-wizard' && wizardPhase !== 'closed') {
      useProvisioningWizardStore.getState().close();
    }
  }, [viewState.view]);

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
  }, [credentials, undoDelete.requestDelete]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      try {
        const vs = await vaultStatus();
        setVault(vs);
      } catch { /* intentional: non-critical */ }
      setLoading(false);
    };
    init();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  // Daily auto-test: run healthchecks if not run today
  useEffect(() => {
    if (loading || credentials.length === 0 || bulk.isRunning) return;
    const lastRun = bulk.summary?.completedAt;
    const today = new Date().toDateString();
    const alreadyRanToday = lastRun && new Date(lastRun).toDateString() === today;
    if (alreadyRanToday) return;
    const timer = setTimeout(() => {
      setIsDailyRun(true);
      bulk.run(credentials);
    }, 1500);
    return () => clearTimeout(timer);
  }, [loading, credentials.length]);

  // Clear daily-run flag when bulk finishes
  useEffect(() => {
    if (!bulk.isRunning && isDailyRun) setIsDailyRun(false);
  }, [bulk.isRunning, isDailyRun]);

  return {
    // Data
    credentials,
    connectorDefinitions,
    loading,
    vault,
    setVault,
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
    isDailyRun,
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
