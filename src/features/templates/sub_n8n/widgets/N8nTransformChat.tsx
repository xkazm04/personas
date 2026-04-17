import { useState, useRef, useEffect } from 'react';
import { Sparkles, CheckCircle2, LayoutList, Layers } from 'lucide-react';
import { N8nQuestionListView } from './N8nQuestionListView';
import { N8nQuestionStepper } from './N8nQuestionStepper';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { StreamingSection } from '@/api/templates/n8nTransform';
import type { TransformQuestion, TransformSubPhase } from '../hooks/useN8nImportReducer';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { StreamingSections } from './StreamingSections';
import { TransformPhaseStepper } from './TransformPhaseStepper';
import { useTranslation } from '@/i18n/useTranslation';

interface N8nTransformChatProps {
  transformSubPhase: TransformSubPhase;
  questions: TransformQuestion[] | null;
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  transformPhase: CliRunPhase;
  transformLines: string[];
  streamingSections: StreamingSection[];
  runId: string | null;
  isRestoring: boolean;
  onRetry: () => void;
  onCancel: () => void;
  /** Error message from the transform -- shown inline when failed */
  errorMessage?: string | null;
}

export function N8nTransformChat({
  transformSubPhase,
  questions,
  userAnswers,
  onAnswerUpdated,
  transformPhase,
  transformLines,
  streamingSections,
  runId,
  isRestoring,
  onRetry,
  onCancel,
  errorMessage,
}: N8nTransformChatProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'list' | 'stepper'>('stepper');

  // Auto-scroll on phase transitions
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [transformSubPhase]);

  return (
    <div ref={scrollRef} className="space-y-4">
      {/* Horizontal phase stepper */}
      <TransformPhaseStepper currentPhase={transformSubPhase} />

      {/* Phase 1: Asking -- unified transform in progress */}
      {transformSubPhase === 'asking' && (
        <div
          className="animate-fade-slide-in space-y-4"
        >
          {streamingSections.length > 0 && (
            <StreamingSections
              sections={streamingSections}
              isStreaming={transformPhase === 'running'}
            />
          )}
          <TransformProgress
            phase={transformPhase}
            lines={transformLines}
            runId={runId}
            isRestoring={isRestoring}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </div>
      )}

      {/* Phase 2: Answering -- questions loaded, user fills in */}
      {transformSubPhase === 'answering' && (
        <>
          {/* Questions available */}
          {questions && questions.length > 0 && (
            <div
              className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 p-4"
            >
              {/* Header with view mode toggle */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-card bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="typo-body font-medium text-foreground/85">
                      A few questions to customize your persona
                    </p>
                    <p className="typo-body text-foreground mt-0.5">
                      Answer below, then click Generate
                    </p>
                  </div>
                </div>
                <div role="tablist" aria-label="Question view mode" className="flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/30 border border-primary/8">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'list'}
                    onClick={() => setViewMode('list')}
                    className={`px-2 py-1 typo-body rounded-card flex items-center gap-1.5 transition-all ${
                      viewMode === 'list'
                        ? 'bg-primary/15 text-foreground/90 shadow-elevation-1'
                        : 'text-foreground hover:text-foreground/70'
                    }`}
                  >
                    <LayoutList className="w-3 h-3" />
                    List
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'stepper'}
                    onClick={() => setViewMode('stepper')}
                    className={`px-2 py-1 typo-body rounded-card flex items-center gap-1.5 transition-all ${
                      viewMode === 'stepper'
                        ? 'bg-primary/15 text-foreground/90 shadow-elevation-1'
                        : 'text-foreground hover:text-foreground/70'
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    Focus
                  </button>
                </div>
              </div>

              {/* List view */}
              {viewMode === 'list' && (
                <N8nQuestionListView
                  questions={questions}
                  userAnswers={userAnswers}
                  onAnswerUpdated={onAnswerUpdated}
                />
              )}

              {/* Focus (stepper) view */}
              {viewMode === 'stepper' && (
                <N8nQuestionStepper
                  questions={questions}
                  userAnswers={userAnswers}
                  onAnswerUpdated={onAnswerUpdated}
                />
              )}
            </div>
          )}

          {/* No questions */}
          {(!questions || questions.length === 0) && (
            <div
              className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-card bg-secondary/40 border border-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
                </div>
                <div>
                  <p className="typo-body text-foreground/90">
                    No configuration needed
                  </p>
                  <p className="typo-body text-foreground mt-0.5">
                    {t.templates.n8n.click_generate_defaults}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Phase 3: Generating -- show answer summary + streaming sections + progress */}
      {transformSubPhase === 'generating' && (
        <>
          {/* Answer summary bubble */}
          {Object.keys(userAnswers).length > 0 && questions && questions.length > 0 && (
            <div
              className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 p-4"
            >
              <p className="typo-body font-medium text-foreground uppercase tracking-wider mb-2">
                Your answers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {questions.map((q) => {
                  const answer = userAnswers[q.id];
                  if (!answer) return null;
                  return (
                    <span
                      key={q.id}
                      className="inline-flex items-center gap-1 px-2 py-1 typo-body rounded-card bg-violet-500/10 text-violet-300/80 border border-violet-500/15"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      {answer.length > 30 ? `${answer.slice(0, 30)}...` : answer}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Streaming sections -- tools, triggers, connectors appear one-by-one */}
          <StreamingSections
            sections={streamingSections}
            isStreaming={transformPhase === 'running'}
          />

          <TransformProgress
            phase={transformPhase}
            lines={transformLines}
            runId={runId}
            isRestoring={isRestoring}
            onRetry={onRetry}
            onCancel={onCancel}
            errorMessage={errorMessage}
          />
        </>
      )}

      {/* Phase 4: Failed -- show progress (which renders failure state) */}
      {transformSubPhase === 'failed' && (
        <TransformProgress
          phase={transformPhase}
          lines={transformLines}
          runId={runId}
          isRestoring={false}
          onRetry={onRetry}
          onCancel={onCancel}
          errorMessage={errorMessage}
        />
      )}

      {/* Idle state -- shouldn't normally be visible, but handle gracefully */}
      {transformSubPhase === 'idle' && (
        <TransformProgress
          phase="idle"
          lines={[]}
          runId={null}
          isRestoring={false}
        />
      )}
    </div>
  );
}
