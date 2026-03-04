import { Sparkles } from 'lucide-react';
import { TransformProgress } from '@/features/shared/components/TransformProgress';
import { useAdoptionWizard } from '../AdoptionWizardContext';

export function BuildStep() {
  const { state, wizard, currentAdoptId, isRestoring, startTransform, cancelTransform } = useAdoptionWizard();

  return (
    <div className="space-y-4">
      <TransformProgress
        phase={state.transformPhase}
        lines={state.transformLines}
        runId={currentAdoptId}
        isRestoring={isRestoring}
        onRetry={() => void startTransform()}
        onCancel={() => void cancelTransform()}
      />

      {state.transforming && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
          <Sparkles className="w-4 h-4 text-blue-400/60 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300/60 leading-relaxed">
            You can close this dialog - processing will continue in the background.
            Re-open the wizard to check progress.
          </p>
        </div>
      )}

      {state.draft && !state.transforming && (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
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
    </div>
  );
}
