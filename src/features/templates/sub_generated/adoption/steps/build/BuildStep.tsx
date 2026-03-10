import { useMemo } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { useAdoptionWizard } from '../../AdoptionWizardContext';

/** Parse transform lines to derive a user-friendly phase description. */
function derivePhaseLabel(lines: string[]): string {
  if (lines.length === 0) return 'Initializing...';
  const last = lines[lines.length - 1]?.toLowerCase() ?? '';
  if (last.includes('tool')) return 'Configuring tools...';
  if (last.includes('trigger')) return 'Setting up triggers...';
  if (last.includes('prompt') || last.includes('system')) return 'Building persona prompt...';
  if (last.includes('connector') || last.includes('service')) return 'Wiring connectors...';
  if (last.includes('validat')) return 'Validating draft...';
  if (last.includes('complet') || last.includes('done') || last.includes('finish')) return 'Finalizing...';
  return 'Generating persona...';
}

export function BuildStep() {
  const {
    state,
    wizard,
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    discardDraft,
    requiredConnectors,
  } = useAdoptionWizard();

  const phaseLabel = useMemo(
    () => derivePhaseLabel(state.transformLines),
    [state.transformLines],
  );

  const connectorCount = requiredConnectors.length;

  return (
    <div className="space-y-3">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Build Persona</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Generating persona prompt, tools, triggers, and connectors based on your selections.
        </p>
      </div>

      {/* Progress */}
      {state.transforming && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />
          <span className="text-sm text-violet-300/80">{phaseLabel}</span>
          {connectorCount > 0 && (
            <span className="text-sm text-muted-foreground/60 ml-auto">{connectorCount} connectors</span>
          )}
        </div>
      )}

      <TransformProgress
        phase={state.transformPhase}
        lines={state.transformLines}
        runId={currentAdoptId}
        isRestoring={isRestoring}
        onRetry={() => void startTransform()}
        onCancel={() => void cancelTransform()}
      />

      {/* Inline error display */}
      {state.error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-400/80">{state.error}</p>
            <button
              type="button"
              onClick={() => void startTransform()}
              className="mt-1.5 text-sm text-red-300 hover:text-red-200 transition-colors underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Background hint */}
      {state.transforming && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10">
          <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300/60 leading-relaxed">
            You can close this dialog â€” processing continues in the background.
          </p>
        </div>
      )}

      {/* Adjustment request (post-build) */}
      {state.draft && !state.transforming && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground/70">
            Request adjustments (optional)
          </label>
          <textarea
            value={state.adjustmentRequest}
            onChange={(e) => wizard.setAdjustment(e.target.value)}
            placeholder="Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications"
            className="w-full h-20 p-3 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 resize-y placeholder-muted-foreground/30"
          />
        </div>
      )}

      {/* Discard draft */}
      {!state.transforming && !state.confirming && (
        <button
          type="button"
          onClick={discardDraft}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/40 hover:text-red-400/70 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Discard draft and start over
        </button>
      )}
    </div>
  );
}
