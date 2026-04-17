import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { VaultErrorBanner } from '@/features/vault/sub_credentials/components/card/banners/VaultErrorBanner';
import { ReauthBanner } from '@/features/vault/sub_credentials/components/card/banners/ReauthBanner';
import { CredentialDeleteDialog } from '@/features/vault/sub_credentials/components/card/CredentialDeleteDialog';
import { useCredentialManagerState } from './useCredentialManagerState';
import { CredentialManagerHeader, CredentialToolbar } from './CredentialManagerHeader';
import { CredentialManagerViews } from './CredentialManagerViews';
import { VaultBreadcrumb } from './VaultBreadcrumb';
import { useTranslation } from '@/i18n/useTranslation';

export function CredentialManager() {
  const { t } = useTranslation();
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
    isRotatingAll,
    rotateAllResult,
    rotatableCount,
    bulk,
    isDailyRun,
    viewState,
    handleRotateAll,
    undoDelete,
    dispatch,
    breadcrumbs,
  } = state;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-foreground">
        <LoadingSpinner size="lg" label={t.vault.manager.loading_credentials} />
      </div>
    );
  }

  return (
    <ContentBox data-testid="credential-manager">
      <CredentialManagerHeader credentialCount={credentials.length} />

      <CredentialToolbar
        credentialCount={credentials.length}
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

      <VaultBreadcrumb segments={breadcrumbs} dispatch={dispatch} />

      <ContentBody>
        <ReauthBanner />

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

        <CredentialManagerViews state={state} />

        <CredentialDeleteDialog
          deleteConfirm={undoDelete.deleteConfirm}
          onConfirmDelete={undoDelete.confirmDelete}
          onCancelDelete={undoDelete.cancelDelete}
        />
      </ContentBody>
    </ContentBox>
  );
}
