import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Ban, CheckCircle2, X, AlertCircle } from 'lucide-react';
import { EventName } from '@/lib/eventRegistry';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { cancelAutoRun, getAutoRunStatus } from '@/api/devTools/devTools';
import type { AutoRunStatus } from '@/lib/bindings/AutoRunStatus';

export interface AutoRunBannerProps {
  projectId?: string;
  /** Bumped by the page when it starts a run, to force an immediate rehydrate. */
  refreshToken?: number;
  /** Called on any terminal transition so the page can reload the queue. */
  onRunFinished?: () => void;
}

/**
 * Auto-run banner, rehydrated from `dev_tools_get_auto_run_status`.
 *
 * The old runner kept auto-run state in component state only, so a reload in
 * the middle of a 40-task run lost the banner entirely. The durable
 * `dev_auto_runs` row (∪ the live scheduler snapshot) means:
 * - `live && status === 'running'` → the live banner with a Cancel action;
 * - a terminal row → a quiet, dismissible summary line.
 */
export function AutoRunBanner({ projectId, refreshToken = 0, onRunFinished }: AutoRunBannerProps) {
  const { t, tx } = useTranslation();
  const dr = t.plugins.dev_runner;
  const [status, setStatus] = useState<AutoRunStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const rehydrate = useCallback(() => {
    getAutoRunStatus(projectId)
      .then((s) => {
        setStatus(s.runId ? s : null);
        if (s.runId && s.live) setDismissed(false);
      })
      .catch(silentCatch('features/plugins/dev-tools/sub_runner/AutoRunBanner:rehydrate'));
  }, [projectId]);

  useEffect(() => {
    rehydrate();
  }, [rehydrate, refreshToken]);

  // Live updates. AUTO_RUN_COMPLETE flips the durable row, so re-reading the
  // backend is both simpler and more truthful than patching a local shape.
  useEffect(() => {
    const completeUn = listen(EventName.AUTO_RUN_COMPLETE, () => {
      rehydrate();
      onRunFinished?.();
    });
    const statusUn = listen(EventName.AUTO_RUN_STATUS, () => rehydrate());
    return () => {
      completeUn.then((fn) => fn()).catch(silentCatch('AutoRunBanner:unlisten-complete'));
      statusUn.then((fn) => fn()).catch(silentCatch('AutoRunBanner:unlisten-status'));
    };
  }, [rehydrate, onRunFinished]);

  const handleCancel = useCallback(async () => {
    if (!status?.runId) return;
    await cancelAutoRun(status.runId);
    rehydrate();
  }, [status, rehydrate]);

  if (!status || !status.runId) return null;

  const running = status.live && status.status === 'running';
  if (!running && dismissed) return null;

  const cancelled = status.status === 'cancelled';
  const failed = status.status === 'failed';

  return (
    <div className="border border-violet-500/25 rounded-card px-3 py-2 bg-violet-500/5 flex items-center gap-3 typo-caption">
      {running ? (
        <LoadingSpinner size="xs" />
      ) : cancelled ? (
        <Ban className="w-3.5 h-3.5 text-foreground" />
      ) : failed ? (
        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
      ) : (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
      )}

      <span className="text-violet-400 font-medium">
        {running ? dr.auto_run_progress : dr.auto_run_last_run}
      </span>

      <span className="text-foreground">
        {running
          ? tx(dr.auto_run_snapshot, { count: status.snapshotSize })
          : tx(dr.auto_run_summary, {
              completed: status.completed,
              failed: status.failed,
              skipped: status.skipped,
            })}
      </span>

      {!running && status.terminationReason && (
        <span className="text-foreground">{status.terminationReason}</span>
      )}

      <div className="ml-auto">
        {running ? (
          <Button variant="secondary" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={handleCancel}>
            {dr.cancel_auto_run}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={() => setDismissed(true)}>
            {t.common.dismiss}
          </Button>
        )}
      </div>
    </div>
  );
}
