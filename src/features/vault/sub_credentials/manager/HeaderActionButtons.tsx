import Button from '@/features/shared/components/buttons/Button';
import { RotateCw, CheckCircle2, Play, Square, CircleCheck, CircleX, CircleHelp } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
    <Button
      type="button"
      onClick={onRotateAll}
      disabled={isRotatingAll || rotatableCount === 0}
      variant={rotateAllResult ? 'accent' : 'secondary'}
      tone={rotateAllResult ? (rotateAllResult.failed > 0 ? 'warning' : 'success') : undefined}
      size="sm"
      tooltip={rotatableCount === 0 ? t.vault.manager.no_rotation_support : tx(rotatableCount === 1 ? t.vault.manager.refresh_oauth_one : t.vault.manager.refresh_oauth_other, { count: rotatableCount })}
      icon={isRotatingAll ? (
        <LoadingSpinner size="xs" />
      ) : rotateAllResult ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <RotateCw className="w-3 h-3" />
      )}
    >
      {isRotatingAll
        ? t.vault.manager.refreshing
        : rotateAllResult
          ? `${tx(t.vault.manager.rotate_result_refreshed, { count: rotateAllResult.rotated })}${rotateAllResult.failed > 0 ? `, ${tx(t.vault.manager.rotate_result_failed, { count: rotateAllResult.failed })}` : ''}${rotateAllResult.skipped > 0 ? ` · ${tx(t.vault.manager.rotate_result_skipped, { count: rotateAllResult.skipped })}` : ''}`
          : rotatableCount > 0
            ? tx(t.vault.manager.rotate_count, { count: rotatableCount })
            : t.vault.manager.rotate}
    </Button>
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
    <Tooltip content={bulk.isRunning ? t.vault.manager.cancel_healthcheck : t.vault.manager.test_all_credentials}>
    <button
      type="button"
      onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
      className={`flex items-center gap-0 rounded-card typo-caption border border-hair overflow-hidden transition-colors hover:bg-surface-2 ${
        bulk.isRunning ? 'text-status-warning' : 'text-ink-1'
      }`}
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
              <Tooltip content={t.vault.manager.unverifiable_tooltip}><span
                className="flex items-center gap-0.5 text-ink-3"
              >
                <CircleHelp className="w-3 h-3" />
                <span>{unverifiable}</span>
              </span></Tooltip>
            )}
          </>
        ) : (
          <span className="text-foreground">--</span>
        )}
      </span>
    </button>
    </Tooltip>
  );
}
