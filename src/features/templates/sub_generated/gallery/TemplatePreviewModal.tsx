import { useMemo } from 'react';
import { X, Play, RotateCcw } from 'lucide-react';
import { TerminalBody } from '@/features/shared/components/TerminalBody';
import { DimensionRadial } from '../shared/DimensionRadial';
import { BaseModal } from '../shared/BaseModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

/**
 * Build a minimal draft JSON from a AgentIR to pass to testN8nDraft.
 * The Rust side only requires `system_prompt` — everything else is optional.
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
  const designResult = useMemo(
    () => review ? parseJsonSafe<AgentIR | null>(review.design_result, null) : null,
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
      panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id="template-preview-title" className="text-lg font-semibold text-foreground/90 truncate">
              Preview: {review.test_case_name}
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-0.5">
              Sandboxed single-turn execution — no persona created
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <DimensionRadial designResult={designResult} size={36} />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
              <X className="w-5 h-5 text-muted-foreground/70" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0">
          {phase === 'idle' && !hasStarted ? (
            /* Pre-run state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
              <div className="w-16 h-16 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Play className="w-7 h-7 text-violet-400" />
              </div>
              <div className="text-center max-w-md">
                <h3 className="text-base font-medium text-foreground/85 mb-1.5">
                  Try this template
                </h3>
                <p className="text-sm text-muted-foreground/60 leading-relaxed">
                  Run a sandboxed single-turn execution to see how this persona behaves.
                  Uses the template's system prompt with mock inputs — nothing is saved.
                </p>
              </div>
              <button
                onClick={handleRun}
                disabled={!designResult}
                className="px-4 py-2.5 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                Run Preview
              </button>
              {!designResult && (
                <p className="text-sm text-red-400/70">
                  No design data available for this template.
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
        <div className="px-6 py-3 border-t border-primary/10 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {phase === 'idle' && hasStarted && (
              <span className="text-sm text-muted-foreground/50">Ready</span>
            )}
            {isRunning && (
              <span className="text-sm text-blue-400/80 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Running...
              </span>
            )}
            {phase === 'completed' && (
              <span className="text-sm text-emerald-400/80">Completed</span>
            )}
            {phase === 'failed' && (
              <span className="text-sm text-red-400/80">
                {error || 'Execution failed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDone && (
              <button
                onClick={handleRetry}
                className="px-3.5 py-2 text-sm rounded-xl bg-secondary/50 text-foreground/70 hover:bg-secondary/80 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Run Again
              </button>
            )}
            {isRunning && (
              <span className="text-sm text-muted-foreground/60">
                You can close — test will continue in background
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-sm rounded-xl text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
    </BaseModal>
  );
}
