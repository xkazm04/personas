import { RotateCw, CheckCircle2, HeartPulse } from 'lucide-react';
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
