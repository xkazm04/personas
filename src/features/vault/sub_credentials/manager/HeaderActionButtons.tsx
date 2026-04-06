import { RotateCw, CheckCircle2, Play, Square, CircleCheck, CircleX } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';

export function RotateAllButton({
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

export function TestAllButton({
  bulk,
  credentials,
  isDailyRun,
}: {
  bulk: ReturnType<typeof useBulkHealthcheck>;
  credentials: CredentialMetadata[];
  isDailyRun?: boolean;
}) {
  const hasSummary = !!bulk.summary;
  const passed = bulk.summary?.passed ?? 0;
  const failed = bulk.summary?.failed ?? 0;

  return (
    <button
      onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
      className={`flex items-center gap-0 rounded-lg text-xs font-medium border transition-colors overflow-hidden ${
        bulk.isRunning
          ? 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/25 dark:border-amber-500/20'
          : hasSummary
            ? failed > 0
              ? 'bg-red-600/8 text-foreground/80 border-red-600/25 dark:border-red-500/20'
              : 'bg-emerald-600/8 text-foreground/80 border-emerald-600/25 dark:border-emerald-500/20'
            : 'border-primary/15 text-foreground/60 hover:bg-primary/5 hover:text-foreground/80'
      }`}
      title={bulk.isRunning ? 'Cancel healthcheck' : 'Test all credentials'}
    >
      {/* Play/Stop icon + label */}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {bulk.isRunning ? (
          <Square className="w-3 h-3 fill-current" />
        ) : (
          <Play className="w-3 h-3 fill-current" />
        )}
        <span>Test All</span>
      </span>

      {/* Divider */}
      <span className={`w-px self-stretch ${
        bulk.isRunning
          ? 'bg-amber-600/20'
          : hasSummary
            ? failed > 0 ? 'bg-red-600/15' : 'bg-emerald-600/15'
            : 'bg-primary/10'
      }`} />

      {/* Status / counts section */}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {bulk.isRunning ? (
          <>
            <LoadingSpinner size="xs" />
            <span>
              {isDailyRun ? 'Daily' : 'Testing'} {bulk.progress.done}/{bulk.progress.total}
            </span>
          </>
        ) : hasSummary ? (
          <>
            <span className="flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="w-3 h-3" />
              <span>{passed}</span>
            </span>
            {failed > 0 && (
              <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <CircleX className="w-3 h-3" />
                <span>{failed}</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground/50">--</span>
        )}
      </span>
    </button>
  );
}
