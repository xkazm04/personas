import { Check, Brain } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

interface NegotiatorPlanningPhaseProps {
  progressLines: string[];
  onCancel: () => void;
}

export function NegotiatorPlanningPhase({ progressLines, onCancel }: NegotiatorPlanningPhaseProps) {
  const { t } = useTranslation();
  return (
    <div
      key="negotiator-planning"
      className="animate-fade-slide-in space-y-4"
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/10 border border-violet-500/20 rounded-modal">
        <Brain className="w-4 h-4 text-violet-400 shrink-0 animate-pulse" />
        <p className="text-sm text-violet-200/80">
          AI is analyzing the developer portal and generating a step-by-step provisioning plan...
        </p>
      </div>

      <div className="px-2 py-3 space-y-0.5" aria-live="polite">
        {progressLines.map((line, i) => {
          const isLast = i === progressLines.length - 1;
          return (
            <div
              key={i}
              className="animate-fade-slide-in flex items-center gap-3 py-1.5"
            >
              {isLast ? (
                <LoadingSpinner size="sm" className="text-violet-400 shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className={`text-sm ${isLast ? 'text-foreground' : 'text-foreground'}`}>
                {line}
              </span>
            </div>
          );
        })}
        {progressLines.length === 0 && (
          <div className="flex items-center gap-3 py-1.5">
            <LoadingSpinner size="sm" className="text-violet-400 shrink-0" />
            <span className="text-sm text-foreground">{t.vault.negotiator.initializing}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-modal text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
