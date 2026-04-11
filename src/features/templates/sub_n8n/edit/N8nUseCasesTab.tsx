import { useState } from 'react';
import { Sparkles, ShieldCheck, Bell, Brain, Radio, Play, Info, ListChecks } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
import { useN8nDesignData } from '../hooks/useN8nDesignData';
import { CAPABILITY_SPLIT_STYLES, CATEGORY_STYLES, MODE_BADGE } from '../colorTokens';
import type { ProtocolType } from './protocolParser';
import { useTranslation } from '@/i18n/useTranslation';

const CAPABILITY_ICONS: Record<ProtocolType, React.ComponentType<{ className?: string }>> = {
  manual_review: ShieldCheck,
  user_message:  Bell,
  agent_memory:  Brain,
  emit_event:    Radio,
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
  const { t } = useTranslation();
  const { contextData, capabilities } = useN8nDesignData(
    draft.design_context,
    draft.system_prompt,
    draft.structured_prompt as Record<string, unknown> | null,
  );
  const useCases: UseCaseItem[] = contextData.useCases ?? [];

  // Mock mode viewer
  const [mockViewId, setMockViewId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Use cases list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {useCases.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <ListChecks className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium text-muted-foreground/60">
              {draft.design_context
                ? t.templates.n8n.no_use_cases_design
                : t.templates.n8n.no_use_cases_yet}
            </p>
            <p className="text-sm text-muted-foreground/60">
              {t.templates.n8n.use_adjustment_hint}
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
                              <span className={`px-1.5 py-0.5 text-sm font-medium rounded-lg border ${catStyle.bg} ${catStyle.text} uppercase tracking-wider`}>
                                {uc.category.replace('-', ' ')}
                              </span>
                            )}
                            <span className={`px-1.5 py-0.5 text-sm font-medium rounded-lg border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
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
                                  ? 'bg-secondary/30 border-primary/10 text-muted-foreground/50 cursor-not-allowed'
                                  : 'bg-secondary/40 border-primary/15 text-foreground/70 hover:bg-primary/10 hover:text-primary hover:border-primary/25'
                            }`}
                            title={
                              mode === 'non_executable'
                                ? t.templates.n8n.informational_only
                                : mode === 'mock'
                                  ? t.templates.n8n.view_example_output
                                  : t.templates.n8n.test_use_case
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
                          <span className="text-sm text-muted-foreground/60 flex-shrink-0 mt-1">
                            {t.templates.n8n.save_to_test}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mock viewer */}
                    {mode === 'mock' && mockViewId === uc.id && (
                      <div className="border-t border-amber-500/15 bg-amber-500/5 p-3">
                        <p className="text-sm text-amber-400/70 mb-1.5">{t.templates.n8n.example_output}</p>
                        <pre className="text-sm font-mono text-foreground/60 bg-background/40 rounded-lg p-2.5 overflow-auto max-h-40 border border-amber-500/10">
                          {uc.sample_input
                            ? JSON.stringify(uc.sample_input, null, 2)
                            : t.templates.n8n.no_sample_data}
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
                const style = CAPABILITY_SPLIT_STYLES[cap.type];
                const CapIcon = CAPABILITY_ICONS[cap.type];
                return (
                  <span
                    key={cap.type}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl border ${style.bg} ${style.text}`}
                    title={cap.context}
                  >
                    <CapIcon className="w-3 h-3" />
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
          {t.templates.n8n.request_ai_adjustments}
        </label>
        <div className="flex gap-2">
          <textarea
            value={adjustmentRequest}
            onChange={(e) => onAdjustmentChange(e.target.value)}
            placeholder={t.templates.n8n.adjustment_placeholder}
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
