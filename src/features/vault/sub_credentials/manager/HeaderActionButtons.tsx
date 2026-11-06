import { RotateCw, CheckCircle2, Play, Square, CircleCheck, CircleX, CircleHelp } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t, tx } = useTranslation();
  return (
    <button
      type="button"
      onClick={onRotateAll}
      disabled={isRotatingAll || rotatableCount === 0}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-card typo-caption border transition-colors ${
        rotatableCount === 0
          ? 'border-hair text-foreground cursor-not-allowed'
          : rotateAllResult
            ? rotateAllResult.failed > 0
              ? 'bg-status-warning/15 text-status-warning dark:text-status-warning border-status-warning/25 dark:border-status-warning/20'
              : 'bg-status-success/15 text-status-success dark:text-status-success border-status-success/25 dark:border-status-success/20'
            : 'border-role-highlight/25 dark:border-role-highlight/20 text-role-highlight dark:text-role-highlight/80 hover:bg-role-highlight/10 dark:hover:bg-role-highlight/10 hover:text-role-highlight dark:hover:text-role-highlight'
      }`}
      title={rotatableCount === 0 ? t.vault.manager.no_rotation_support : tx(rotatableCount === 1 ? t.vault.manager.refresh_oauth_one : t.vault.manager.refresh_oauth_other, { count: rotatableCount })}
    >
      {isRotatingAll ? (
        <LoadingSpinner size="xs" />
      ) : rotateAllResult ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <RotateCw className="w-3 h-3" />
      )}
      {isRotatingAll
        ? t.vault.manager.refreshing
        : rotateAllResult
          ? `${tx(t.vault.manager.rotate_result_refreshed, { count: rotateAllResult.rotated })}${rotateAllResult.failed > 0 ? `, ${tx(t.vault.manager.rotate_result_failed, { count: rotateAllResult.failed })}` : ''}${rotateAllResult.skipped > 0 ? ` · ${tx(t.vault.manager.rotate_result_skipped, { count: rotateAllResult.skipped })}` : ''}`
          : rotatableCount > 0
            ? tx(t.vault.manager.rotate_count, { count: rotatableCount })
            : t.vault.manager.rotate}
    </button>
  );
}

export function TestAllButton({
  bulk,
  credentials,
}: {
  bulk: ReturnType<typeof useBulkHealthcheck>;
  credentials: CredentialMetadata[];
}) {
  const { t, tx } = useTranslation();
  const hasSummary = !!bulk.summary;
  const passed = bulk.summary?.passed ?? 0;
  const failed = bulk.summary?.failed ?? 0;
  // Connectors with no live probe at all -- stored but never checked against
  // the provider. Must render as its own neutral bucket, not folded into
  // `passed`: the backend's legacy `success` boolean is `true` for these too,
  // so counting on it alone would show "N passed, 0 failed" even when none of
  // the N were ever actually verified.
  //
  // Credentials with no live probe at all: neither passed nor failed. Carried
  // all the way from `BulkHealthcheckSummary` (src-tauri/src/engine/healthcheck.rs)
  // through `useBulkHealthcheck`'s `BulkSummary`, so the count is real rather
  // than defaulted -- a 0 here means "none unverifiable", not "unknown".
  const unverifiable = bulk.summary?.unverifiable ?? 0;
  // Only claim the "all healthy" emerald treatment when every credential was
  // actually probed and passed. If any were unverifiable (no probe exists at
  // all), the button must NOT read as a clean bill of health even when
  // failed === 0 -- that combination previously rendered identically to
  // "every credential verified working".
  const allVerified = hasSummary && failed === 0 && unverifiable === 0;
  const anyFailed = hasSummary && failed > 0;

  return (
    <button
      type="button"
      onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
      className={`flex items-center gap-0 rounded-card typo-caption border transition-colors overflow-hidden ${
        bulk.isRunning
          ? 'bg-status-warning/15 text-status-warning dark:text-status-warning border-status-warning/25 dark:border-status-warning/20'
          : hasSummary
            ? anyFailed
              ? 'bg-status-error/8 text-foreground border-status-error/25 dark:border-status-error/20'
              : allVerified
                ? 'bg-status-success/8 text-foreground border-status-success/25 dark:border-status-success/20'
                : 'bg-foreground/5 text-foreground border-foreground/15'
            : 'border-hair text-foreground hover:bg-primary/5 hover:text-ink-2'
      }`}
      title={bulk.isRunning ? t.vault.manager.cancel_healthcheck : t.vault.manager.test_all_credentials}
    >
      {/* Play/Stop icon + label */}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {bulk.isRunning ? (
          <Square className="w-3 h-3 fill-current" />
        ) : (
          <Play className="w-3 h-3 fill-current" />
        )}
        <span>{t.vault.manager.test_all}</span>
      </span>

      {/* Divider */}
      <span className={`w-px self-stretch ${
        bulk.isRunning
          ? 'bg-status-warning/20'
          : hasSummary
            ? anyFailed ? 'bg-status-error/15' : allVerified ? 'bg-status-success/15' : 'bg-foreground/10'
            : 'bg-primary/10'
      }`} />

      {/* Status / counts section */}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {bulk.isRunning ? (
          <>
            <LoadingSpinner size="xs" />
            <span>
              {tx(t.vault.manager.testing_progress, { done: bulk.progress.done, total: bulk.progress.total })}
            </span>
          </>
        ) : hasSummary ? (
          <>
            <span className="flex items-center gap-0.5 text-status-success dark:text-status-success">
              <CircleCheck className="w-3 h-3" />
              <span>{passed}</span>
            </span>
            {failed > 0 && (
              <span className="flex items-center gap-0.5 text-status-error dark:text-status-error">
                <CircleX className="w-3 h-3" />
                <span>{failed}</span>
              </span>
            )}
            {unverifiable > 0 && (
              <span
                className="flex items-center gap-0.5 text-ink-3"
                title={t.vault.manager.unverifiable_tooltip}
              >
                <CircleHelp className="w-3 h-3" />
                <span>{unverifiable}</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-foreground">--</span>
        )}
      </span>
    </button>
  );
}
