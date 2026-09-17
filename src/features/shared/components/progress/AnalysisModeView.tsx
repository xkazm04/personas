import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, RotateCcw, XCircle } from 'lucide-react';
import type { AnalysisPhaseInfo } from './transformProgressTypes';
import { TerminalBody } from './TerminalBody';
import { useTranslation } from '@/i18n/useTranslation';

interface AnalysisModeViewProps {
  lines: string[];
  isRunning: boolean;
  analysisPhase: AnalysisPhaseInfo | null;
  /** Stop a running analysis. Omit to hide the cancel affordance. */
  onCancel?: () => void;
  /** Re-run a failed analysis. Omit to show the failure without a retry. */
  onRetry?: () => void;
  /** Already-translated failure message; its presence is what marks a failure. */
  errorMessage?: string | null;
  /** Explicit failure flag for a run that failed without a message. */
  failed?: boolean;
}

export function AnalysisModeView({
  lines,
  isRunning,
  analysisPhase,
  onCancel,
  onRetry,
  errorMessage,
  failed,
}: AnalysisModeViewProps) {
  const { t } = useTranslation();
  const [showTerminal, setShowTerminal] = useState(true);
  const hasFailed = !isRunning && (failed === true || !!errorMessage);

  // A failure reveals the output, mirroring TransformModeView: the terminal is
  // the only place the user can see what actually happened.
  useEffect(() => {
    if (hasFailed) setShowTerminal(true);
  }, [hasFailed]);

  return (
    <div className="border border-primary/15 rounded-xl overflow-hidden bg-background shadow-[0_0_15px_rgba(0,0,0,0.2)]" role="status" aria-live="polite">
      {isRunning && analysisPhase && (
          <div
            key={analysisPhase.step}
            className="animate-fade-slide-in flex items-center gap-3 px-4 py-2 bg-blue-500/5 border-b border-blue-500/10"
          >
            <span className="typo-code text-blue-400/60 shrink-0">
              Step {analysisPhase.step} of {analysisPhase.total}
            </span>
            <div className="flex-1 h-1 rounded-full bg-secondary/30 overflow-hidden">
              <div
                className="animate-fade-in h-full rounded-full bg-blue-400/40" style={{ width: `${(analysisPhase.step / analysisPhase.total) * 100}%` }}
              />
            </div>
            <span className="typo-body text-blue-400/80 truncate">{analysisPhase.label}</span>
          </div>
        )}

      {/* Stop a wedged analysis from the card the user is watching, rather than
          from a distant footer. */}
      {isRunning && onCancel && (
        <div className="flex items-center justify-end px-4 py-2 border-b border-primary/10">
          <button
            type="button"
            onClick={onCancel}
            aria-label={t.shared.progress_extra.cancel_analysis}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            {t.common.cancel}
          </button>
        </div>
      )}

      {hasFailed && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="typo-body text-red-400">{t.shared.progress_extra.analysis_failed}</p>
            <p className="typo-caption text-red-400/70 truncate">
              {errorMessage || t.shared.progress_extra.check_output_details}
            </p>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-xl border border-red-500/25 text-red-400 hover:bg-red-500/15 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.common.retry}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTerminal(!showTerminal)}
        className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 border-b border-primary/10 cursor-pointer hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {showTerminal ? (
            <ChevronDown className="w-3.5 h-3.5 text-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-foreground" />
          )}
          <span className="typo-code text-foreground">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {analysisPhase ? analysisPhase.label : 'Analyzing...'}
              </span>
            ) : (
              'Complete'
            )}
          </span>
        </div>
        <span className="typo-code text-foreground">{lines.length} lines</span>
      </button>

      {showTerminal && <TerminalBody lines={lines} />}
    </div>
  );
}
