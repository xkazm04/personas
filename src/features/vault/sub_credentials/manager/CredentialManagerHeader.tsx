import { type RefObject } from 'react';
import { Search, Key, X } from 'lucide-react';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import type { ViewName } from '@/features/vault/shared/hooks/useCredentialViewFSM';
import { RotateAllButton, TestAllButton } from './HeaderActionButtons';

/* -- Title-only header (no actions) -------------------------------- */

interface CredentialManagerHeaderProps {
  credentialCount: number;
  view: ViewName;
}

export function CredentialManagerHeader({ credentialCount, view }: CredentialManagerHeaderProps) {
  const { t, tx } = useTranslation();
  const m = t.vault.manager;
  const isCatalog = view === 'catalog-browse' || view === 'catalog-form' || view === 'catalog-auto-setup';
  const isDependencies = view === 'graph';
  const isDatabases = view === 'databases';
  const title = isCatalog
    ? m.title_catalog
    : isDependencies
      ? m.title_dependencies
      : isDatabases
        ? m.title_databases
        : m.title;
  // The "N credentials stored" subtitle only makes sense on the credentials
  // list — Catalog / Dependencies / Databases get a bare title.
  const subtitle = isCatalog || isDependencies || isDatabases
    ? undefined
    : tx(credentialCount === 1 ? m.credentials_stored_one : m.credentials_stored_other, { count: credentialCount });
  return (
    <ContentHeader
      icon={<Key className="w-5 h-5 text-emerald-400" />}
      iconColor="emerald"
      title={title}
      subtitle={subtitle}
    />
  );
}

/* -- Toolbar row (search + actions) -------------------------------- */

interface CredentialToolbarProps {
  credentialCount: number;
  isRotatingAll: boolean;
  rotateAllResult: { rotated: number; failed: number; skipped: number } | null;
  rotatableCount: number;
  onRotateAll: () => void;
  /** Show the Rotate-all / Test-all action buttons. Only the credentials list
   *  view wants them — Catalog / Databases / Dependencies hide them. */
  showActions: boolean;
  credentialSearch: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  showSearchBar: boolean;
  isCatalogView: boolean;
  credentials: CredentialMetadata[];
  bulk: ReturnType<typeof useBulkHealthcheck>;
}

export function CredentialToolbar({
  credentialCount,
  isRotatingAll,
  rotateAllResult,
  rotatableCount,
  onRotateAll,
  showActions,
  credentialSearch,
  onSearchChange,
  searchInputRef,
  showSearchBar,
  isCatalogView,
  credentials,
  bulk,
}: CredentialToolbarProps) {
  const { t } = useTranslation();
  const { isStarter: isSimple } = useTier();

  // Nothing to render (e.g. Databases / Dependencies / Add-flow views have
  // neither a search bar nor the credential actions) — skip the toolbar row
  // entirely so it doesn't leave an empty bordered strip.
  if (!showSearchBar && !(showActions && !isSimple)) return null;

  return (
    <div className="flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-secondary/20 flex-shrink-0">
      {/* Search */}
      {showSearchBar && (
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
          <input
            ref={searchInputRef}
            data-testid="credential-search"
            type="text"
            value={credentialSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              isCatalogView
                ? t.vault.manager.search_catalog
                : t.vault.manager.search_credentials
            }
            className="w-full pl-8 pr-8 py-1.5 rounded-card border border-primary/15 bg-background/80 typo-body text-foreground placeholder-muted-foreground/40 focus-ring"
          />
          {credentialSearch && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/80 transition-colors"
              title={t.vault.manager.clear_search}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Spacer */}
      {!showSearchBar && <div className="flex-1" />}

      {/* Action buttons — credentials list only, hidden in simple mode */}
      {showActions && !isSimple && (
      <div className="flex items-center gap-1.5 shrink-0">
        {credentialCount > 0 && (
          <RotateAllButton
            isRotatingAll={isRotatingAll}
            rotateAllResult={rotateAllResult}
            rotatableCount={rotatableCount}
            onRotateAll={onRotateAll}
          />
        )}

        {credentials.length > 0 && (
          <TestAllButton bulk={bulk} credentials={credentials} />
        )}
      </div>
      )}
    </div>
  );
}
