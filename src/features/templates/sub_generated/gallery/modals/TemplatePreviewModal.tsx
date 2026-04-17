import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { X, Play, RotateCcw } from 'lucide-react';
import { TerminalBody } from '@/features/shared/components/terminal/TerminalBody';
import { DimensionRadial } from '../../shared/DimensionRadial';
import { ThinkingLoader } from '../../shared/ThinkingLoader';
import { BaseModal } from '../../shared/BaseModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { BORDER_SUBTLE, BORDER_DEFAULT } from '@/lib/utils/designTokens';

/**
 * Build a minimal draft JSON from a AgentIR to pass to testN8nDraft.
 * The Rust side only requires `system_prompt` -- everything else is optional.
 */
function buildDraftJson(designResult: AgentIR, name: string): string {
  const sp = designResult.structured_prompt;
  const sections = [
    sp.identity,
    sp.instructions,
    sp.toolGuidance ? `Tool Guidance:\n${sp.toolGuidance}` : '',
    sp.errorHandling ? `Error Handling:\n${sp.errorHandling}` : '',
    sp.examples ? `Examples:\n${sp.examples}` : '',
    ...(sp.customSections ?? []).map((s) => `${s.label}:\n${s.content}`),
  ].filter(Boolean);

  const systemPrompt = sections.join('\n\n');

  const draft = {
    name,
    description: designResult.summary || null,
    system_prompt: systemPrompt,
    structured_prompt: designResult.structured_prompt,
    icon: null,
    color: null,
    model_profile: null,
    max_budget_usd: null,
    max_turns: 1,
    design_context: null,
  };

  return JSON.stringify(draft, null, 2);
}

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  /** Externally managed stream state */
  phase: CliRunPhase;
  lines: string[];
  error: string | null;
  hasStarted: boolean;
  onStartPreview: (reviewId: string, reviewName: string, draftJson: string) => void;
  onRetryPreview: (draftJson: string) => void;
}

export function TemplatePreviewModal({
  isOpen,
  onClose,
  review,
  phase,
  lines,
  error,
  hasStarted,
  onStartPreview,
  onRetryPreview,
}: TemplatePreviewModalProps) {
  const { t } = useTranslation();
  const designResult = useMemo(
    () => review ? getCachedDesignResult(review) : null,
    [review],
  );

  const handleRun = () => {
    if (!review || !designResult) return;
    const draftJson = buildDraftJson(designResult, review.test_case_name);
    onStartPreview(review.id, review.test_case_name, draftJson);
  };

  const handleRetry = () => {
    if (!review || !designResult) return;
    const draftJson = buildDraftJson(designResult, review.test_case_name);
    onRetryPreview(draftJson);
  };

  if (!isOpen || !review) return null;

  const isRunning = phase === 'running';
  const isDone = phase === 'completed' || phase === 'failed';

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="template-preview-title"
      maxWidthClass="max-w-5xl"
      panelClassName={`max-h-[85vh] bg-background border ${BORDER_DEFAULT} rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden`}
    >
        {/* Header */}
        <div className={`px-6 py-4 border-b ${BORDER_SUBTLE} flex items-center justify-between gap-4 flex-shrink-0`}>
          <div className="min-w-0 flex-1">
            <h2 id="template-preview-title" className="typo-heading-lg text-foreground/90 truncate">
              {t.templates.preview_modal.preview_title.replace('{name}', review.test_case_name)}
            </h2>
            <p className="typo-body text-foreground mt-0.5">
              {t.templates.preview_modal.sandboxed_hint}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <DimensionRadial designResult={designResult} size={36} />
            <button onClick={onClose} className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors">
              <X className="w-5 h-5 text-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0">
          {phase === 'idle' && !hasStarted ? (
            /* Pre-run state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
              <div className="w-16 h-16 rounded-modal bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Play className="w-7 h-7 text-violet-400" />
              </div>
              <div className="text-center max-w-md">
                <h3 className="typo-body-lg font-medium text-foreground/85 mb-1.5">
                  {t.templates.preview_modal.try_this_template}
                </h3>
                <p className="typo-body text-foreground leading-relaxed">
                  {t.templates.preview_modal.try_description}
                </p>
              </div>
              <button
                onClick={handleRun}
                disabled={!designResult}
                className="px-4 py-2.5 typo-body rounded-modal bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none"
              >
                <Play className="w-4 h-4" />
                {t.templates.preview_modal.run_preview}
              </button>
              {!designResult && (
                <p className="typo-body text-red-400/70">
                  {t.templates.preview_modal.no_design_data}
                </p>
              )}
            </div>
          ) : (
            /* Terminal output */
            <div className="flex-1 flex flex-col min-h-0">
              <TerminalBody
                lines={lines}
                isRunning={isRunning}
                flexFill
                showCursor
                enableUnseenCounter
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-3 border-t ${BORDER_SUBTLE} flex items-center justify-between flex-shrink-0`}>
          <div className="flex items-center gap-2">
            {phase === 'idle' && hasStarted && (
              <span className="typo-body text-foreground">{t.templates.preview_modal.ready}</span>
            )}
            {isRunning && (
              <span className="typo-body text-blue-400/80 flex items-center gap-1.5">
                <ThinkingLoader size={20} />
                {t.templates.preview_modal.running}
              </span>
            )}
            {phase === 'completed' && (
              <span className="typo-body text-emerald-400/80">{t.templates.preview_modal.completed}</span>
            )}
            {phase === 'failed' && (
              <span className="typo-body text-red-400/80">
                {error || t.templates.preview_modal.execution_failed}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDone && (
              <button
                onClick={handleRetry}
                className="px-3.5 py-2 typo-body rounded-modal bg-secondary/50 text-foreground hover:bg-secondary/80 transition-colors flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.templates.preview_modal.run_again}
              </button>
            )}
            {isRunning && (
              <span className="typo-body text-foreground">
                {t.templates.preview_modal.close_test_continues}
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-2 typo-body rounded-modal text-foreground hover:text-foreground/80 hover:bg-secondary/50 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none"
            >
              {t.common.close}
            </button>
          </div>
        </div>
    </BaseModal>
  );
}
