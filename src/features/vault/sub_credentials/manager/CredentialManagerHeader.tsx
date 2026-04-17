import { type RefObject } from 'react';
import { Search, Key, X } from 'lucide-react';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';
import { VaultStatusBadge } from '@/features/vault/sub_credentials/components/card/badges/VaultStatusBadge';
import type { VaultStatus } from "@/api/vault/credentials";
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import { RotateAllButton, TestAllButton } from './HeaderActionButtons';

/* -- Title-only header (no actions) -------------------------------- */

interface CredentialManagerHeaderProps {
  credentialCount: number;
}

export function CredentialManagerHeader({ credentialCount }: CredentialManagerHeaderProps) {
  const { t, tx } = useTranslation();
  return (
    <ContentHeader
      icon={<Key className="w-5 h-5 text-emerald-400" />}
      iconColor="emerald"
      title={t.vault.manager.title}
      subtitle={tx(credentialCount === 1 ? t.vault.manager.credentials_stored_one : t.vault.manager.credentials_stored_other, { count: credentialCount })}
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
  vault: VaultStatus | null;
  onVaultRefresh: (v: VaultStatus) => void;
  credentialSearch: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  showSearchBar: boolean;
  isCatalogView: boolean;
  credentials: CredentialMetadata[];
  bulk: ReturnType<typeof useBulkHealthcheck>;
  isDailyRun?: boolean;
}

export function CredentialToolbar({
  credentialCount,
  isRotatingAll,
  rotateAllResult,
  rotatableCount,
  onRotateAll,
  vault,
  onVaultRefresh,
  credentialSearch,
  onSearchChange,
  searchInputRef,
  showSearchBar,
  isCatalogView,
  credentials,
  bulk,
  isDailyRun,
}: CredentialToolbarProps) {
  const { t } = useTranslation();
  const { isStarter: isSimple } = useTier();

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

      {/* Action buttons (hidden in simple mode except vault badge) */}
      {!isSimple && (
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
          <TestAllButton bulk={bulk} credentials={credentials} isDailyRun={isDailyRun} />
        )}

        {vault && <VaultStatusBadge vault={vault} onVaultRefresh={onVaultRefresh} />}
      </div>
      )}
    </div>
  );
}
