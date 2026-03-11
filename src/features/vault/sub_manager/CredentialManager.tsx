import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { VaultErrorBanner } from '@/features/vault/sub_card/banners/VaultErrorBanner';
import { CredentialRelationshipGraph } from '@/features/vault/sub_graph/CredentialRelationshipGraph';
import { CredentialDeleteDialog } from '@/features/vault/sub_card/CredentialDeleteDialog';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { useCredentialManagerState } from './useCredentialManagerState';
import { CredentialManagerHeader, CredentialToolbar } from './CredentialManagerHeader';
import { CredentialManagerViews } from './CredentialManagerViews';

export function CredentialManager() {
  const isSimple = useSimpleMode();
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

  if (loading) return null;

  return (
    <ContentBox>
      <CredentialManagerHeader credentialCount={credentials.length} />

      <CredentialToolbar
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
        credentials={credentials}
        bulk={bulk}
        isDailyRun={isDailyRun}
      />

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

        {!isSimple && showGraph && viewState.view === 'list' && (
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
