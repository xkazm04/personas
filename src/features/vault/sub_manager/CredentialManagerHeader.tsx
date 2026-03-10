import type { RefObject } from 'react';
import { Search, Key, X, RotateCw, Loader2, CheckCircle2, Network } from 'lucide-react';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { VaultStatusBadge } from '@/features/vault/sub_card/VaultStatusBadge';
import type { VaultStatus } from '@/api/tauriApi';

interface CredentialManagerHeaderProps {
  credentialCount: number;
  showGraph: boolean;
  onToggleGraph: () => void;
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
}

export function CredentialManagerHeader({
  credentialCount,
  showGraph,
  onToggleGraph,
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
}: CredentialManagerHeaderProps) {
  return (
    <ContentHeader
      icon={<Key className="w-5 h-5 text-emerald-400" />}
      iconColor="emerald"
      title="Credentials"
      subtitle={`${credentialCount} credential${credentialCount !== 1 ? 's' : ''} stored`}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleGraph}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              showGraph
                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25'
                : 'border-primary/15 text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
            }`}
            title="View credential dependency graph"
          >
            <Network className="w-3 h-3" />
            Graph
          </button>
          {credentialCount > 0 && (
            <RotateAllButton
              isRotatingAll={isRotatingAll}
              rotateAllResult={rotateAllResult}
              rotatableCount={rotatableCount}
              onRotateAll={onRotateAll}
            />
          )}
          {vault && <VaultStatusBadge vault={vault} onVaultRefresh={onVaultRefresh} />}
        </div>
      }
    >
      {showSearchBar && (
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
          <input
            ref={searchInputRef}
            type="text"
            value={credentialSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              isCatalogView
                ? 'Search catalog by label, type, or category'
                : 'Search credentials by name, type, or connector'
            }
            className="w-full pl-9 pr-20 py-2 rounded-xl border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {credentialSearch && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-12 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-sm px-1.5 py-0.5 rounded border border-primary/15 bg-secondary/40 text-muted-foreground/60 font-mono pointer-events-none">
            {navigator.platform?.includes('Mac') ? '\u2318K' : 'Ctrl+K'}
          </kbd>
        </div>
      )}
    </ContentHeader>
  );
}

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
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
        rotatableCount === 0
          ? 'border-primary/10 text-muted-foreground/50 cursor-not-allowed'
          : rotateAllResult
            ? rotateAllResult.failed > 0
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'border-cyan-500/20 text-cyan-400/80 hover:bg-cyan-500/10 hover:text-cyan-400'
      }`}
      title={rotatableCount === 0 ? 'No credentials support automatic rotation' : `Refresh ${rotatableCount} OAuth credential${rotatableCount !== 1 ? 's' : ''}`}
    >
      {isRotatingAll ? (
        <Loader2 className="w-3 h-3 animate-spin" />
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
