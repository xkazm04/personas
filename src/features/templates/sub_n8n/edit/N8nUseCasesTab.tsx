import { useMemo, useState } from 'react';
import { Sparkles, ShieldCheck, Bell, Brain, Radio, Play, Info, ListChecks } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/UseCasesList';
import { extractProtocolCapabilities, type ProtocolType } from './protocolParser';

const CAPABILITY_STYLES: Record<ProtocolType, { Icon: React.ComponentType<{ className?: string }>; bg: string; text: string }> = {
  manual_review: { Icon: ShieldCheck, bg: 'bg-rose-500/8 border-rose-500/15', text: 'text-rose-400/70' },
  user_message:  { Icon: Bell,        bg: 'bg-amber-500/8 border-amber-500/15', text: 'text-amber-400/70' },
  agent_memory:  { Icon: Brain,       bg: 'bg-cyan-500/8 border-cyan-500/15', text: 'text-cyan-400/70' },
  emit_event:    { Icon: Radio,       bg: 'bg-violet-500/8 border-violet-500/15', text: 'text-violet-400/70' },
};

const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  e2e:            { label: 'E2E',  bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400/80' },
  mock:           { label: 'MOCK', bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400/80' },
  non_executable: { label: 'INFO', bg: 'bg-secondary/50 border-primary/15',     text: 'text-muted-foreground/70' },
};

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-rose-500/10 border-rose-500/15',   text: 'text-rose-400/70' },
  'data-sync':    { bg: 'bg-cyan-500/10 border-cyan-500/15',   text: 'text-cyan-400/70' },
  monitoring:     { bg: 'bg-amber-500/10 border-amber-500/15', text: 'text-amber-400/70' },
  automation:     { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication:  { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400/70' },
  reporting:      { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

interface N8nUseCasesTabProps {
  draft: N8nPersonaDraft;
  adjustmentRequest: string;
  transforming: boolean;
  disabled: boolean;
  onAdjustmentChange: (text: string) => void;
  onApplyAdjustment: () => void;
  onTestUseCase?: (useCaseId: string, sampleInput?: Record<string, unknown>) => void;
  testingUseCaseId?: string | null;
}

export function N8nUseCasesTab({
  draft,
  adjustmentRequest,
  transforming,
  disabled,
  onAdjustmentChange,
  onApplyAdjustment,
  onTestUseCase,
  testingUseCaseId,
}: N8nUseCasesTabProps) {
  const capabilities = useMemo(
    () => extractProtocolCapabilities(
      draft.system_prompt,
      draft.structured_prompt as Record<string, unknown> | null,
    ),
    [draft.system_prompt, draft.structured_prompt],
  );

  const contextData = useMemo(() => parseDesignContext(draft.design_context), [draft.design_context]);
  const useCases: UseCaseItem[] = contextData.useCases ?? [];

  // Mock mode viewer
  const [mockViewId, setMockViewId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Use cases list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
        {useCases.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <ListChecks className="w-5 h-5 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground/60">
              {draft.design_context
                ? 'No structured use cases found in design context.'
                : 'No use cases generated yet.'}
            </p>
            <p className="text-sm text-muted-foreground/40">
              Use the adjustment input below to request use case generation.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1">
              <ListChecks className="w-3.5 h-3.5 text-muted-foreground/80" />
              <p className="text-sm text-muted-foreground/80">
                {useCases.length} use case{useCases.length !== 1 ? 's' : ''} identified
              </p>
            </div>

            <div className="space-y-2">
              {useCases.map((uc, i) => {
                const mode = uc.execution_mode ?? 'e2e';
                const modeBadge = (MODE_BADGE[mode] ?? MODE_BADGE.e2e)!;
                const catStyle = uc.category ? CATEGORY_STYLES[uc.category] : null;
                const isTesting = testingUseCaseId === uc.id;

                return (
                  <div key={uc.id || i} className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
                    <div className="p-3.5">
                      <div className="flex items-start gap-3">
                        <span className="text-sm font-semibold text-muted-foreground/50 mt-0.5 w-5 text-right flex-shrink-0">
                          {i + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground/95">{uc.title}</p>
                            {uc.category && catStyle && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${catStyle.bg} ${catStyle.text} uppercase tracking-wider`}>
                                {uc.category.replace('-', ' ')}
                              </span>
                            )}
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
                              {modeBadge.label}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/60 mt-1 leading-relaxed">
                            {uc.description}
                          </p>
                        </div>

                        {/* Test button */}
                        {onTestUseCase && (
                          <button
                            onClick={() => {
                              if (mode === 'mock') {
                                setMockViewId(mockViewId === uc.id ? null : uc.id);
                              } else {
                                onTestUseCase(uc.id, uc.sample_input ?? undefined);
                              }
                            }}
                            disabled={mode === 'non_executable'}
                            className={`p-1.5 rounded-lg border transition-colors flex-shrink-0 ${
                              isTesting
                                ? 'bg-primary/20 border-primary/30 text-primary'
                                : mode === 'non_executable'
                                  ? 'bg-secondary/30 border-primary/10 text-muted-foreground/30 cursor-not-allowed'
                                  : 'bg-secondary/40 border-primary/15 text-foreground/70 hover:bg-primary/10 hover:text-primary hover:border-primary/25'
                            }`}
                            title={
                              mode === 'non_executable'
                                ? 'This use case is informational only'
                                : mode === 'mock'
                                  ? 'View example output'
                                  : 'Test this use case'
                            }
                          >
                            {isTesting ? (
                              <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                                <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-40" />
                                <span className="relative rounded-full h-2 w-2 bg-primary" />
                              </span>
                            ) : mode === 'non_executable' ? (
                              <Info className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {!onTestUseCase && mode !== 'non_executable' && (
                          <span className="text-xs text-muted-foreground/30 flex-shrink-0 mt-1">
                            Save to test
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mock viewer */}
                    {mode === 'mock' && mockViewId === uc.id && (
                      <div className="border-t border-amber-500/15 bg-amber-500/5 p-3">
                        <p className="text-xs text-amber-400/70 mb-1.5">Example output:</p>
                        <pre className="text-xs font-mono text-foreground/60 bg-background/40 rounded-lg p-2.5 overflow-auto max-h-40 border border-amber-500/10">
                          {uc.sample_input
                            ? JSON.stringify(uc.sample_input, null, 2)
                            : '// No sample data provided'}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

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
