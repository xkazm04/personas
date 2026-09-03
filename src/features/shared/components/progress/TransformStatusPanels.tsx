import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  XCircle,
  RotateCcw,
  Clock,
  Ban,
} from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformPhaseInfo } from './transformProgressTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface TransformStatusPanelsProps {
  phase: CliRunPhase;
  transformPhase: TransformPhaseInfo | null;
  progressPercent: number;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  errorMessage?: string | null;
}

export function TransformStatusPanels({
  phase,
  transformPhase,
  progressPercent,
  isRestoring,
  onRetry,
  onCancel,
  errorMessage,
}: TransformStatusPanelsProps) {
  const { t } = useTranslation();
  const PhaseIcon = transformPhase?.Icon ?? Sparkles;

  // The run is accepted but has not been given a slot yet. Deliberately NOT
  // the running panel: there is no progress to animate, so a spinner and a
  // 0%-wide bar would be a lie. Cancelling is still allowed.
  if (phase === 'queued') {
    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center flex-shrink-0">
          <Clock className="w-6 h-6 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-foreground">{t.monitor.status_queued}</p>
          <p className="typo-body text-foreground mt-0.5">
            {t.shared.progress_extra.continue_working}
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-2 typo-heading rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
            aria-label={t.shared.progress_extra.cancel_transformation}
          >
            <XCircle className="w-3.5 h-3.5" />
            {t.common.cancel}
          </button>
        )}
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div className="space-y-3">
        {isRestoring && (
          <div
            className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400/70" />
            <span className="typo-body text-amber-400/80">{t.shared.progress_extra.resuming}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <div
              className="animate-fade-in absolute inset-0 w-12 h-12 rounded-xl bg-violet-500/15"
            />
            <div className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <PhaseIcon className="w-6 h-6 text-violet-400" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p
                key={transformPhase?.label ?? 'processing'}
                className="animate-fade-slide-in typo-heading text-foreground"
              >
                {transformPhase?.label ?? t.shared.progress_extra.starting_transformation}
              </p>
            <p className="typo-body text-foreground mt-0.5">
              {transformPhase
                ? t.shared.progress_extra.step_progress
                    .replace('{step}', String(transformPhase.step))
                    .replace('{total}', String(transformPhase.total))
                : t.shared.progress_extra.starting_short}
            </p>

            <div className="mt-3 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
              <div
                className="animate-fade-in h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400/40" style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="typo-body text-foreground mt-2">
              {t.shared.progress_extra.continue_working}
            </p>
          </div>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 typo-heading rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
              title={t.shared.progress_extra.cancel_transformation}
            >
              <XCircle className="w-3.5 h-3.5" />
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'completed') {
    return (
      <div className="flex items-center gap-4">
        <div
          className="animate-fade-scale-in w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <p className="typo-heading text-emerald-400">{t.shared.progress_extra.draft_generated}</p>
          <p className="typo-body text-foreground mt-0.5">
            {t.shared.progress_extra.draft_ready}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-red-400">{t.shared.progress_extra.transformation_failed}</p>
          <p className="typo-body text-red-400/60 mt-0.5">
            {errorMessage || t.shared.progress_extra.check_output_details}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }

  // The run was cancelled -- by the user, or by the engine reclaiming it.
  // Not an error, so no red treatment and no error message, but the spinner
  // must stop and a retry must be offered.
  if (phase === 'cancelled') {
    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center flex-shrink-0">
          <Ban className="w-6 h-6 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-foreground">{t.monitor.status_cancelled}</p>
          <p className="typo-body text-foreground mt-0.5">
            {t.shared.progress_extra.check_output_details}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }

  // `incomplete` (the run stopped without reporting a result) and `unknown`
  // (a status this build does not recognise). Both are terminal: whatever
  // happened, nothing more is coming, so say so instead of spinning.
  if (phase === 'incomplete' || phase === 'unknown') {
    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-6 h-6 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-amber-400">{t.agents.executions.stopped_while_running}</p>
          <p className="typo-body text-amber-400/60 mt-0.5">
            {errorMessage || t.shared.progress_extra.check_output_details}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }

  // idle
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-foreground" />
      </div>
      <div>
        <p className="typo-body text-foreground">{t.shared.progress_extra.waiting_to_start}</p>
        <p className="typo-body text-foreground mt-0.5">
          {t.shared.progress_extra.click_generate}
        </p>
      </div>
    </div>
  );
}
