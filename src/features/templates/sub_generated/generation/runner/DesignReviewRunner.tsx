import { X, Play, Square, Copy, Check, Clock, AlertCircle } from 'lucide-react';
import type { RunProgress } from '@/hooks/design/template/useDesignReviews';
import type { PredefinedTestCase } from './designRunnerConstants';
import { TemplateSourcePanel } from '../sources/TemplateSourcePanel';
import { TerminalOutput, ResultSummary } from './DesignReviewTerminal';
import { ModeTabBar } from '../sources/ModeTabBar';
import { useDesignRunnerState } from './useDesignRunnerState';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';

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
  const { t } = useTranslation();
  const state = useDesignRunnerState({
    isOpen, isRunning, lines, runProgress, personaName, onStart, onClose,
  });

  if (!isOpen) return null;

  return (
    <BaseModal
        isOpen
        onClose={() => { if (!isRunning) onClose(); }}
        titleId="design-runner-title"
        size="lg"
        panelClassName="animate-fade-slide-in max-h-[85vh] bg-background border border-hair rounded-card shadow-elevation-4 flex flex-col overflow-hidden"
        staggerChildren={false}
      >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-hair bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-card bg-role-agent/15 border border-role-agent/25 flex items-center justify-center">
                <Play className="w-4 h-4 text-role-agent" />
              </div>
              <div>
                <h3 id="design-runner-title" className="typo-heading text-ink-1">{t.templates.generation.runner_title}</h3>
                <p className="typo-body text-foreground">
                  {isRunning ? t.templates.generation.runner_running : result ? t.templates.generation.runner_complete : t.templates.generation.runner_configure}
                </p>
              </div>
            </div>
            {!isRunning && (
              <button type="button" onClick={onClose} className="w-8 h-8 rounded-card hover:bg-surface-2 flex items-center justify-center transition-colors">
                <X className="w-4 h-4 text-foreground" />
              </button>
            )}
          </div>

          {/* Persona context banner */}
          {!state.hasStarted && (
            <div className={`px-4 py-3 border-b flex items-center gap-3 ${
              state.hasPersona ? 'border-hair bg-role-agent/5' : 'border-status-warning/20 bg-status-warning/5'
            }`}>
              {state.hasPersona ? (
                <>
                  <div className="w-7 h-7 rounded-card bg-role-agent/15 border border-role-agent/25 flex items-center justify-center flex-shrink-0">
                    <span className="typo-body">AI</span>
                  </div>
                  <div className="min-w-0">
                    <p className="typo-body text-ink-1 truncate">{personaName}</p>
                    {personaDescription && <p className="typo-body text-foreground truncate">{personaDescription}</p>}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-status-warning flex-shrink-0" />
                  <p className="typo-body text-status-warning">{t.templates.generation.no_persona_warning}</p>
                </>
              )}
            </div>
          )}

          {/* Mode selection */}
          {!state.hasStarted && (
            <div className="px-4 py-4 border-b border-hair space-y-4">
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
            <div className="px-4 py-3 border-b border-hair bg-primary/5" aria-live="polite" aria-atomic="true">
              <div className="flex items-center justify-between mb-1.5">
                <span className="typo-body text-foreground">
                  {t.templates.generation.template_progress.replace('{current}', String(state.progressInfo.current)).replace('{total}', String(state.progressInfo.total))}
                  <span className="text-foreground ml-1.5">-- {state.progressInfo.pct}%</span>
                </span>
                <span className="flex items-center gap-1.5 typo-body text-foreground">
                  <Clock className="w-3 h-3" />{state.progressInfo.eta}
                </span>
              </div>
              {state.progressInfo.currentTemplateName && (
                <p className="typo-body text-role-agent/70 mb-2 truncate">{t.templates.generation.generating.replace('{name}', state.progressInfo.currentTemplateName!)}</p>
              )}
              <div className="w-full h-2 rounded-full bg-surface-2 border border-hair overflow-hidden">
                <div
                  role="progressbar"
                  aria-valuenow={state.progressInfo.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Design review progress: ${state.progressInfo.pct}%`}
                  className="animate-fade-in h-full rounded-full bg-role-agent/80"
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
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-hair">
            {isRunning ? (
              <button type="button" onClick={onCancel} className="px-4 py-2 typo-body rounded-modal bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20 transition-colors flex items-center gap-2">
                <Square className="w-3.5 h-3.5" />{t.common.cancel}
              </button>
            ) : !state.hasStarted ? (
              <button
                type="button"
                onClick={state.handleStart}
                disabled={!state.hasPersona || (state.mode === 'custom' && state.validCustomCount === 0) || (state.mode === 'batch' && state.filteredBatchTemplates.length === 0)}
                className="px-4 py-2 typo-body rounded-modal bg-role-agent/15 text-role-agent border border-role-agent/25 hover:bg-role-agent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {state.mode === 'predefined' ? t.templates.generation.start_review_predefined
                  : state.mode === 'batch' ? t.templates.generation.start_batch.replace('{count}', String(state.filteredBatchTemplates.length)).replace('{plural}', state.filteredBatchTemplates.length !== 1 ? 's' : '')
                  : t.templates.generation.start_review_custom.replace('{count}', String(state.validCustomCount)).replace('{plural}', state.validCustomCount !== 1 ? 's' : '')}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {lines.length > 0 && (
                  <button type="button" onClick={state.handleCopyLog} className="px-4 py-2 typo-body rounded-modal bg-surface-2 text-foreground border border-hair hover:bg-secondary/80 hover:text-ink-1 transition-colors flex items-center gap-2">
                    {state.copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
                    {state.copied ? t.templates.generation.copied_log : t.templates.generation.copy_log}
                  </button>
                )}
                <button type="button" onClick={onClose} className="px-4 py-2 typo-body rounded-modal bg-primary/10 text-foreground border border-hair hover:bg-primary/20 transition-colors">{t.common.close}</button>
              </div>
            )}
          </div>
      </BaseModal>
  );
}
