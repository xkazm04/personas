import { useMemo, type RefObject } from 'react';
import { Search, Key, X, RotateCw, CheckCircle2, HeartPulse, AlertCircle, HelpCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { VaultStatusBadge } from '@/features/vault/sub_card/badges/VaultStatusBadge';
import type { VaultStatus } from "@/api/vault/credentials";
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/hooks/health/useBulkHealthcheck';

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

  const isSimple = useSimpleMode();

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

/* -- Rotate All button --------------------------------------------- */

function RotateAllButton({
  isRotatingAll,
  rotateAllResult,
  rotatableCount,
  onRotateAll,
}: {
  isRotatingAll: boolean;
  rotateAllResult: { rotated: number; failed: number; skipped: number } | null;
  rotatableCount: number;
  onRotateAll: () => void;
}) {
  return (
    <button
      onClick={onRotateAll}
      disabled={isRotatingAll || rotatableCount === 0}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        rotatableCount === 0
          ? 'border-primary/10 text-muted-foreground/50 cursor-not-allowed'
          : rotateAllResult
            ? rotateAllResult.failed > 0
              ? 'bg-amber-600/15 text-amber-600 dark:text-amber-400 border-amber-600/25 dark:border-amber-500/20'
              : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25 dark:border-emerald-500/20'
            : 'border-cyan-600/25 dark:border-cyan-500/20 text-cyan-700 dark:text-cyan-400/80 hover:bg-cyan-600/10 dark:hover:bg-cyan-500/10 hover:text-cyan-700 dark:hover:text-cyan-400'
      }`}
      title={rotatableCount === 0 ? 'No credentials support automatic rotation' : `Refresh ${rotatableCount} OAuth credential${rotatableCount !== 1 ? 's' : ''}`}
    >
      {isRotatingAll ? (
        <LoadingSpinner size="xs" />
      ) : rotateAllResult ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <RotateCw className="w-3 h-3" />
      )}
      {isRotatingAll
        ? 'Refreshing...'
        : rotateAllResult
          ? `${rotateAllResult.rotated} refreshed${rotateAllResult.failed > 0 ? `, ${rotateAllResult.failed} failed` : ''}${rotateAllResult.skipped > 0 ? ` \u00b7 ${rotateAllResult.skipped} skipped` : ''}`
          : rotatableCount > 0
            ? `Rotate (${rotatableCount})`
            : 'Rotate'}
    </button>
  );
}

/* -- Test All button ----------------------------------------------- */

function TestAllButton({
  bulk,
  credentials,
  isDailyRun,
}: {
  bulk: ReturnType<typeof useBulkHealthcheck>;
  credentials: CredentialMetadata[];
  isDailyRun?: boolean;
}) {
  return (
    <button
      onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        bulk.isRunning
          ? 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/25 dark:border-amber-500/20'
          : bulk.summary
            ? bulk.summary.failed > 0
              ? 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/25 dark:border-red-500/20'
              : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25 dark:border-emerald-500/20'
            : 'border-violet-600/25 dark:border-violet-500/20 text-violet-700 dark:text-violet-400/80 hover:bg-violet-600/10 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-400'
      }`}
      title={bulk.isRunning ? 'Cancel healthcheck' : 'Test all credentials'}
    >
      {bulk.isRunning ? (
        <LoadingSpinner size="xs" />
      ) : bulk.summary ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <HeartPulse className="w-3 h-3" />
      )}
      {bulk.isRunning
        ? isDailyRun
          ? `Daily ${bulk.progress.done}/${bulk.progress.total}...`
          : `Testing ${bulk.progress.done}/${bulk.progress.total}...`
        : bulk.summary
          ? `${bulk.summary.passed} passed${bulk.summary.failed > 0 ? `, ${bulk.summary.failed} failed` : ''}`
          : 'Test All'}
    </button>
  );
}
