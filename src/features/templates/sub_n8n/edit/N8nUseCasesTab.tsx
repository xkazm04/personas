import { Sparkles } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import { UseCasesList } from '@/features/shared/components/UseCasesList';

interface N8nUseCasesTabProps {
  draft: N8nPersonaDraft;
  adjustmentRequest: string;
  transforming: boolean;
  disabled: boolean;
  onAdjustmentChange: (text: string) => void;
  onApplyAdjustment: () => void;
}

export function N8nUseCasesTab({
  draft,
  adjustmentRequest,
  transforming,
  disabled,
  onAdjustmentChange,
  onApplyAdjustment,
}: N8nUseCasesTabProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {/* Use cases list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <UseCasesList
          designContext={draft.design_context}
          emptyMessage={
            draft.design_context
              ? 'No structured use cases found in design context.'
              : 'No use cases generated yet.'
          }
          emptyHint="Use the adjustment input below to request use case generation."
        />
      </div>

      {/* Adjustment request panel */}
      <div className="border-t border-primary/10 pt-4 space-y-2 flex-shrink-0">
        <label className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Request AI Adjustments
        </label>
        <div className="flex gap-2">
          <textarea
            value={adjustmentRequest}
            onChange={(e) => onAdjustmentChange(e.target.value)}
            placeholder="Example: Add more use cases, make error handling stricter..."
            className="flex-1 h-16 p-2.5 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground/75 resize-none placeholder-muted-foreground/30"
            disabled={disabled || transforming}
          />
          <button
            onClick={onApplyAdjustment}
            disabled={disabled || transforming || !adjustmentRequest.trim()}
            className="self-end px-4 py-2 text-sm font-medium rounded-xl border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
