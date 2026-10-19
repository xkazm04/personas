import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Ban, CheckCircle2, X, AlertCircle, AlertTriangle } from 'lucide-react';
import { EventName } from '@/lib/eventRegistry';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { silentCatch } from '@/lib/silentCatch';
import { cancelAutoRun, getAutoRunStatus } from '@/api/devTools/devTools';
import type { AutoRunStatus } from '@/lib/bindings/AutoRunStatus';

export type AutoRunOutcome = 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';

/**
 * What the banner may claim about a run, from the durable row and the live map.
 *
 * `dev_auto_runs.status` is written `running` at start and only rewritten by
 * the run's own finish/cancel/panic paths. A hard kill (app closed, crash)
 * reaches none of them, so the row stays `running` with `live: false` and zero
 * tallies. That row used to fall through to the success branch: a green check
 * over "0 completed · 0 failed · 0 skipped" for a wave that never finished.
 * Anything this table does not name is not a success either.
 */
export function autoRunOutcome(status: Pick<AutoRunStatus, 'status' | 'live'>): AutoRunOutcome {
  switch (status.status) {
    case 'running':
      return status.live ? 'running' : 'interrupted';
    case 'completed':
    case 'cancelled':
    case 'failed':
      return status.status;
    default:
      return 'interrupted';
  }
}

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

  const outcome = autoRunOutcome(status);
  const running = outcome === 'running';
  if (!running && dismissed) return null;

  const cancelled = outcome === 'cancelled';
  const failed = outcome === 'failed';
  const interrupted = outcome === 'interrupted';

  return (
    <div className="border border-violet-500/25 rounded-card px-3 py-2 bg-violet-500/5 flex items-center gap-3 typo-caption">
      {running ? (
        <LoadingSpinner size="xs" />
      ) : cancelled ? (
        <Ban className="w-3.5 h-3.5 text-foreground" />
      ) : failed ? (
        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
      ) : interrupted ? (
        <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />
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

      {interrupted ? (
        <span className="text-status-warning">{tokenLabel(t, 'execution', 'incomplete')}</span>
      ) : !running && status.terminationReason && (
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
