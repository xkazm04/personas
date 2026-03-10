import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { VaultErrorBanner } from '@/features/vault/sub_card/VaultErrorBanner';
import { CredentialRelationshipGraph } from '@/features/vault/sub_graph/CredentialRelationshipGraph';
import { CredentialDeleteDialog } from '@/features/vault/sub_card/CredentialDeleteDialog';
import { HealthStatusBar } from '@/features/vault/sub_manager/HealthStatusBar';
import { useCredentialManagerState } from './useCredentialManagerState';
import { CredentialManagerHeader } from './CredentialManagerHeader';
import { CredentialManagerViews } from './CredentialManagerViews';

export function CredentialManager() {
  const state = useCredentialManagerState();

  const {
    credentials,
    loading,
    vault,
    setVault,
    bannerError,
    setError,
    setGlobalError,
    credentialSearch,
    setCredentialSearch,
    searchInputRef,
    showGraph,
    setShowGraph,
    isRotatingAll,
    rotateAllResult,
    rotatableCount,
    bulk,
    isDailyRun,
    viewState,
    handleRotateAll,
    undoDelete,
  } = state;

  if (loading) {
    return (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <ContentBox>
      <CredentialManagerHeader
        credentialCount={credentials.length}
        showGraph={showGraph}
        onToggleGraph={() => setShowGraph((p) => !p)}
        isRotatingAll={isRotatingAll}
        rotateAllResult={rotateAllResult}
        rotatableCount={rotatableCount}
        onRotateAll={handleRotateAll}
        vault={vault}
        onVaultRefresh={setVault}
        credentialSearch={credentialSearch}
        onSearchChange={setCredentialSearch}
        searchInputRef={searchInputRef}
        showSearchBar={viewState.view === 'list' || viewState.view === 'catalog-browse'}
        isCatalogView={viewState.view === 'catalog-browse'}
      />

      {credentials.length > 0 && (
        <HealthStatusBar credentials={credentials} bulk={bulk} isDailyRun={isDailyRun} />
      )}

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

        {showGraph && viewState.view === 'list' && (
          <div className="mb-3">
            <CredentialRelationshipGraph />
          </div>
        )}

        <CredentialManagerViews state={state} />

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
