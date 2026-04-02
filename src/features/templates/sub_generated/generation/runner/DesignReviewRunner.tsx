import { X, Play, Square, Copy, Check, Clock, AlertCircle } from 'lucide-react';
import type { RunProgress } from '@/hooks/design/template/useDesignReviews';
import type { PredefinedTestCase } from './designRunnerConstants';
import { TemplateSourcePanel } from '../sources/TemplateSourcePanel';
import { TerminalOutput, ResultSummary } from './DesignReviewTerminal';
import { ModeTabBar } from '../sources/ModeTabBar';
import { useDesignRunnerState } from './useDesignRunnerState';

export type { PredefinedTestCase } from './designRunnerConstants';

interface TestRunResult {
  testRunId: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
}

interface DesignReviewRunnerProps {
  isOpen: boolean;
  onClose: () => void;
  lines: string[];
  isRunning: boolean;
  result: TestRunResult | null;
  runProgress: RunProgress | null;
  personaName?: string;
  personaDescription?: string;
  onStart: (options?: { testCases?: PredefinedTestCase[] }) => void;
  onCancel: () => void;
}

export default function DesignReviewRunner({
  isOpen, onClose, lines, isRunning, result, runProgress,
  personaName, personaDescription, onStart, onCancel,
}: DesignReviewRunnerProps) {
  const state = useDesignRunnerState({
    isOpen, isRunning, lines, runProgress, personaName, onStart, onClose,
  });

  if (!isOpen) return null;

  return (
    <div
        className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && !isRunning && onClose()}
      >
        <div
          ref={state.modalRef}
          role="dialog" aria-modal="true" aria-labelledby="design-runner-title"
          className="animate-fade-slide-in max-w-3xl w-full mx-4 sm:mx-6 md:mx-auto max-h-[85vh] bg-background border border-primary/20 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-primary/10 bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Play className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <h3 id="design-runner-title" className="text-sm font-semibold text-foreground/90">Run Design Review</h3>
                <p className="text-sm text-muted-foreground/90">
                  {isRunning ? 'Running tests...' : result ? 'Review complete' : 'Configure and start a review run'}
                </p>
              </div>
            </div>
            {!isRunning && (
              <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-secondary/50 flex items-center justify-center transition-colors">
                <X className="w-4 h-4 text-muted-foreground/90" />
              </button>
            )}
          </div>

          {/* Persona context banner */}
          {!state.hasStarted && (
            <div className={`px-4 py-3 border-b flex items-center gap-3 ${
              state.hasPersona ? 'border-primary/10 bg-violet-500/5' : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              {state.hasPersona ? (
                <>
                  <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">AI</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground/90 truncate">{personaName}</p>
                    {personaDescription && <p className="text-sm text-muted-foreground/80 truncate">{personaDescription}</p>}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-sm text-amber-400">No persona selected. Select a persona in the sidebar before generating templates.</p>
                </>
              )}
            </div>
          )}

          {/* Mode selection */}
          {!state.hasStarted && (
            <div className="px-4 py-4 border-b border-primary/10 space-y-4">
              <ModeTabBar mode={state.mode} onModeChange={state.setMode} batchCount={state.batchTemplates.length} />
              {state.mode === 'predefined' && <TemplateSourcePanel mode="predefined" />}
              {state.mode === 'custom' && (
                <TemplateSourcePanel
                  mode="custom"
                  cases={state.customCases}
                  validCount={state.validCustomCount}
                  onAdd={() => state.setCustomCases((prev) => [...prev, { name: '', instruction: '' }])}
                  onRemove={(index) => state.setCustomCases((prev) => prev.filter((_, i) => i !== index))}
                  onUpdateCase={(index, field, value) =>
                    state.setCustomCases((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
                  }
                  onFileUpload={state.handleFileUpload}
                />
              )}
              {state.mode === 'batch' && (
                <TemplateSourcePanel
                  mode="batch"
                  templates={state.batchTemplates}
                  categoryFilter={state.batchCategoryFilter}
                  onCategoryFilterChange={state.setBatchCategoryFilter}
                  onClear={() => { state.setBatchTemplates([]); state.setBatchCategoryFilter(null); }}
                  onFileUpload={state.handleFileUpload}
                />
              )}
            </div>
          )}

          {/* Progress Bar */}
          {isRunning && state.progressInfo && (
            <div className="px-4 py-3 border-b border-primary/10 bg-primary/5" aria-live="polite" aria-atomic="true">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground/80">
                  Template {state.progressInfo.current} of {state.progressInfo.total}
                  <span className="text-muted-foreground/90 ml-1.5">-- {state.progressInfo.pct}%</span>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground/90">
                  <Clock className="w-3 h-3" />{state.progressInfo.eta}
                </span>
              </div>
              {state.progressInfo.currentTemplateName && (
                <p className="text-sm text-violet-400/70 mb-2 truncate">Generating: {state.progressInfo.currentTemplateName}</p>
              )}
              <div className="w-full h-2 rounded-full bg-secondary/50 border border-primary/10 overflow-hidden">
                <div
                  role="progressbar"
                  aria-valuenow={state.progressInfo.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Design review progress: ${state.progressInfo.pct}%`}
                  className="animate-fade-in h-full rounded-full bg-violet-500/80"
                  style={{ width: `${state.progressInfo.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Terminal */}
          <TerminalOutput lines={lines} isRunning={isRunning} hasStarted={state.hasStarted} animateFromRef={state.animateFromRef} />

          {/* Result summary */}
          {result && <ResultSummary result={result} />}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-primary/10">
            {isRunning ? (
              <button onClick={onCancel} className="px-4 py-2 text-sm rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-2">
                <Square className="w-3.5 h-3.5" />Cancel
              </button>
            ) : !state.hasStarted ? (
              <button
                onClick={state.handleStart}
                disabled={!state.hasPersona || (state.mode === 'custom' && state.validCustomCount === 0) || (state.mode === 'batch' && state.filteredBatchTemplates.length === 0)}
                className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {state.mode === 'predefined' ? 'Start Review (5 cases)'
                  : state.mode === 'batch' ? `Start Batch (${state.filteredBatchTemplates.length} template${state.filteredBatchTemplates.length !== 1 ? 's' : ''})`
                  : `Start Review (${state.validCustomCount} case${state.validCustomCount !== 1 ? 's' : ''})`}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {lines.length > 0 && (
                  <button onClick={state.handleCopyLog} className="px-4 py-2 text-sm rounded-xl bg-secondary/50 text-muted-foreground/90 border border-primary/15 hover:bg-secondary/80 hover:text-foreground/95 transition-colors flex items-center gap-2">
                    {state.copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {state.copied ? 'Copied!' : 'Copy Log'}
                  </button>
                )}
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-primary/10 text-foreground/80 border border-primary/20 hover:bg-primary/20 transition-colors">Close</button>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
