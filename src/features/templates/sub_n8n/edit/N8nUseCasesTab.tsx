import { useMemo } from 'react';
import { Sparkles, ShieldCheck, Bell, Brain, Radio } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import { UseCasesList } from '@/features/shared/components/UseCasesList';
import { extractProtocolCapabilities, type ProtocolType } from './protocolParser';

const CAPABILITY_STYLES: Record<ProtocolType, { Icon: React.ComponentType<{ className?: string }>; bg: string; text: string }> = {
  manual_review: { Icon: ShieldCheck, bg: 'bg-rose-500/8 border-rose-500/15', text: 'text-rose-400/70' },
  user_message:  { Icon: Bell,        bg: 'bg-amber-500/8 border-amber-500/15', text: 'text-amber-400/70' },
  agent_memory:  { Icon: Brain,       bg: 'bg-cyan-500/8 border-cyan-500/15', text: 'text-cyan-400/70' },
  emit_event:    { Icon: Radio,       bg: 'bg-violet-500/8 border-violet-500/15', text: 'text-violet-400/70' },
};

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
  const capabilities = useMemo(
    () => extractProtocolCapabilities(
      draft.system_prompt,
      draft.structured_prompt as Record<string, unknown> | null,
    ),
    [draft.system_prompt, draft.structured_prompt],
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Use cases list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
        <UseCasesList
          designContext={draft.design_context}
          emptyMessage={
            draft.design_context
              ? 'No structured use cases found in design context.'
              : 'No use cases generated yet.'
          }
          emptyHint="Use the adjustment input below to request use case generation."
        />

        {/* Protocol capabilities */}
        {capabilities.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-primary/10">
            <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider px-1">
              Capabilities
            </p>
            <div className="flex flex-wrap gap-1.5">
              {capabilities.map((cap) => {
                const style = CAPABILITY_STYLES[cap.type];
                return (
                  <span
                    key={cap.type}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-lg border ${style.bg} ${style.text}`}
                    title={cap.context}
                  >
                    <style.Icon className="w-3 h-3" />
                    {cap.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
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
