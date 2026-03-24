import { Wand2, X } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

// -- Streaming Log Panel --------------------------------------------

interface StreamingLogPanelProps {
  outputLines: string[];
  isGenerating: boolean;
  error: string | null;
  onDismiss: () => void;
}

export function StreamingLogPanel({ outputLines, isGenerating, error, onDismiss }: StreamingLogPanelProps) {
  return (
    <div className="relative max-h-48 overflow-y-auto rounded-xl bg-background/50 border border-primary/10 p-3 font-mono text-sm text-muted-foreground/60 leading-relaxed">
      {/* Dismiss button (only when not actively generating) */}
      {!isGenerating && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {outputLines.slice(-30).map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {/* Processing indicator */}
      {isGenerating && (
        <div className="flex items-center gap-1.5 mt-1 text-primary/60">
          <LoadingSpinner size="xs" />
          <span>Processing...</span>
        </div>
      )}
      {/* Inline error after log lines */}
      {error && !isGenerating && (
        <div className="mt-2 pt-2 border-t border-red-400/20 text-red-400/80">
          Something went wrong. Please try again.
        </div>
      )}
    </div>
  );
}

// -- Builder Action Bar ---------------------------------------------

interface BuilderActionBarProps {
  hasIntent: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onContinue: () => void;
  onCancel?: () => void;
}

export function BuilderActionBar({
  hasIntent,
  canGenerate,
  isGenerating,
  onGenerate,
  onContinue,
  onCancel,
}: BuilderActionBarProps) {
  return (
    <div className="flex items-center justify-between pt-3">
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground/80 transition-colors"
        >
          Cancel
        </button>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-2">
        {canGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="px-4 py-2.5 text-sm font-medium rounded-xl border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            {isGenerating ? 'Enhancing...' : 'Enhance with AI'}
          </button>
        )}
        <div className="flex flex-col items-end">
          <button
            type="button"
            onClick={onContinue}
            disabled={!hasIntent}
            className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition-all flex items-center gap-2 ${
              hasIntent
                ? 'bg-btn-primary hover:bg-btn-primary/90 text-white shadow-md shadow-btn-primary/25 hover:shadow-btn-primary/35 hover:scale-[1.01] active:scale-[0.99]'
                : 'bg-secondary/50 text-muted-foreground/50 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
          {!hasIntent && (
            <p
              className="animate-fade-slide-in text-muted-foreground text-xs mt-1.5"
            >
              Describe what your agent should do
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
