import { useMemo, type RefObject } from 'react';
import { Search, Key, X, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTier } from '@/hooks/utility/interaction/useTier';
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
  return (
    <ContentHeader
      icon={<Key className="w-5 h-5 text-emerald-400" />}
      iconColor="emerald"
      title="Credentials"
      subtitle={`${credentialCount} credential${credentialCount !== 1 ? 's' : ''} stored`}
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
  const healthCounts = useMemo(() => {
    let healthy = 0;
    let failing = 0;
    let untested = 0;
    for (const cred of credentials) {
      if (cred.healthcheck_last_success === null || cred.healthcheck_last_success === undefined) {
        untested++;
      } else if (cred.healthcheck_last_success) {
        healthy++;
      } else {
        failing++;
      }
    }
    return { healthy, failing, untested };
  }, [credentials]);

  const { isStarter: isSimple } = useTier();

  return (
    <div className="flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-secondary/20 flex-shrink-0">
      {/* Search */}
      {showSearchBar && (
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            ref={searchInputRef}
            data-testid="credential-search"
            type="text"
            value={credentialSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              isCatalogView
                ? 'Search catalog...'
                : 'Search credentials...'
            }
            className="w-full pl-8 pr-16 py-1.5 rounded-lg border border-primary/15 bg-background/80 text-sm text-foreground placeholder-muted-foreground/40 focus-ring"
          />
          {credentialSearch && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-10 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-1 py-0.5 rounded border border-primary/15 bg-secondary/40 text-muted-foreground/60 font-mono pointer-events-none">
            {navigator.platform?.includes('Mac') ? '\u2318K' : 'Ctrl+K'}
          </kbd>
        </div>
      )}

      {/* Spacer */}
      {!showSearchBar && <div className="flex-1" />}

      {/* Health counts (inline, hidden in simple mode) */}
      {!isSimple && credentials.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          {healthCounts.healthy > 0 && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              <span className="font-medium">{healthCounts.healthy}</span>
              <span className="text-foreground/50 hidden sm:inline">healthy</span>
            </span>
          )}
          {healthCounts.failing > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />
              <span className="font-medium">{healthCounts.failing}</span>
              <span className="text-foreground/50 hidden sm:inline">attention</span>
            </span>
          )}
          {healthCounts.untested > 0 && (
            <span className="flex items-center gap-1 text-foreground/60">
              <HelpCircle className="w-3 h-3" />
              <span className="font-medium">{healthCounts.untested}</span>
              <span className="text-foreground/50 hidden sm:inline">untested</span>
            </span>
          )}
        </div>
      )}

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
