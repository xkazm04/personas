import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformPhaseInfo } from './transformProgressTypes';

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
  const PhaseIcon = transformPhase?.Icon ?? Sparkles;

  if (phase === 'running') {
    return (
      <div className="space-y-3">
        {isRestoring && (
          <div
            className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400/70" />
            <span className="typo-body text-amber-400/80">Resuming previous transformation session...</span>
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
                className="animate-fade-slide-in typo-heading text-foreground/80"
              >
                {transformPhase?.label ?? 'Starting transformation...'}
              </p>
            <p className="typo-body text-muted-foreground/80 mt-0.5">
              {transformPhase ? `Step ${transformPhase.step} of ${transformPhase.total}` : 'Starting...'}
            </p>

            <div className="mt-3 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
              <div
                className="animate-fade-in h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400/40" style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="typo-body text-muted-foreground/90 mt-2">
              You can continue working -- we'll notify you when the draft is ready.
            </p>
          </div>

          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 typo-heading rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
              title="Cancel transformation"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
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
          <p className="typo-heading text-emerald-400">Draft generated successfully</p>
          <p className="typo-body text-muted-foreground/80 mt-0.5">
            Your persona draft is ready for review and editing.
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
          <p className="typo-heading text-red-400">Transformation failed</p>
          <p className="typo-body text-red-400/60 mt-0.5">
            {errorMessage || 'Check the output below for details.'}
          </p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>
    );
  }

  // idle
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-muted-foreground/80" />
      </div>
      <div>
        <p className="typo-body text-muted-foreground/90">Waiting to start transformation...</p>
        <p className="typo-body text-muted-foreground/80 mt-0.5">
          Click "Generate Persona Draft" to begin.
        </p>
      </div>
    </div>
  );
}
