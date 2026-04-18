/**
 * MatrixCommandCenterParts -- extracted sub-components for MatrixCommandCenter.
 *
 * Build constants → matrixBuildConstants.ts
 * Test report modal + helpers → TestReportModal.tsx
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, X, HelpCircle, CheckCircle2, Send, RefreshCw, Save,
  XCircle, Eye, RotateCcw, FileText, AlertTriangle, Trash2,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { DesignQuestion } from '@/lib/types/designTypes';
import type { ToolTestResult } from '@/lib/types/buildTypes';
import { useAgentStore } from '@/stores/agentStore';
import { TestReportModal } from './TestReportModal';
import { useTranslation } from '@/i18n/useTranslation';

// Import constants used locally + re-export for backward compatibility
import { CELL_FRIENDLY_NAMES, ORB_GLOW_CLASSES, type BuildPhase } from './matrixBuildConstants';
export { CELL_FRIENDLY_NAMES, ORB_GLOW_CLASSES } from './matrixBuildConstants';
export type { BuildPhase } from './matrixBuildConstants';

interface PromptSection { key: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; content: string; }

// -- Components ---------------------------------------------------------------

export function PromptModal({ section, onClose }: { section: PromptSection; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);
  const Icon = section.icon;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5"><Icon className={`w-4.5 h-4.5 ${section.color}`} /><h3 className="typo-body-lg font-semibold text-foreground/90">{section.label}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-card hover:bg-foreground/[0.04] transition-colors"><X className="w-4 h-4 text-foreground" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap typo-body text-foreground font-sans leading-relaxed">{section.content}</pre></div>
      </div>
    </div>,
    document.body,
  );
}

export function CapabilityToggle({ icon: Icon, label, active, onToggle }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={[
      'inline-flex items-center gap-1.5 rounded-card border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
      active
        ? 'border-primary/30 bg-primary/15 text-primary'
        : 'border-primary/10 bg-transparent text-foreground hover:text-muted-foreground/60 hover:border-primary/20',
    ].join(' ')}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
  );
}

/** Radial launch orb -- the visual centerpiece of the matrix. */
export function LaunchOrb({ onClick, disabled, isRunning, label, icon, buildPhase }: { onClick?: () => void; disabled: boolean; isRunning: boolean; label: string; icon?: React.ReactNode; buildPhase?: BuildPhase }) {
  const { t } = useTranslation();
  const orbGlow = buildPhase ? (ORB_GLOW_CLASSES[buildPhase] ?? '') : '';
  const blocked = disabled && !isRunning;
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isRunning}
        data-testid="agent-launch-btn"
        className="group relative w-16 h-16 rounded-full flex items-center justify-center disabled:cursor-not-allowed transition-all duration-300"
      >
        <span className={`absolute inset-0 rounded-full border-2 transition-colors ${
          blocked
            ? 'border-orange-500/30 dark:border-amber-500/25 shadow-[0_0_12px_rgba(234,88,12,0.2)] dark:shadow-[0_0_12px_rgba(245,158,11,0.15)]'
            : 'border-primary/25 group-hover:border-primary/50 group-disabled:border-primary/10 shadow-[0_0_16px_var(--glass-bg)]'
        } ${orbGlow}`} />
        {isRunning && <span className="absolute inset-[-4px] rounded-full border border-primary/20 animate-ping" />}
        <span className={`absolute inset-[3px] rounded-full transition-colors ${
          blocked
            ? 'bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-red-500/10 dark:from-amber-500/15 dark:via-amber-500/5 dark:to-orange-500/10'
            : 'bg-gradient-to-br from-primary/20 via-primary/10 to-accent/15 group-hover:from-primary/30 group-hover:via-primary/15 group-hover:to-accent/25'
        }`} />
        {isRunning
          ? <LoadingSpinner size="xl" className="text-primary relative z-10" />
          : icon ?? <Play className={`w-6 h-6 relative z-10 transition-colors ${
              blocked ? 'text-orange-600/60 dark:text-amber-500/50' : 'text-primary/80 group-hover:text-primary'
            }`} />}
      </button>
      <span className={`text-[11px] font-medium tracking-wide uppercase ${
        blocked ? 'text-orange-600/70 dark:text-amber-500/60' : 'text-foreground'
      }`}>
        {isRunning ? t.templates.matrix.generating : label}
      </span>
    </div>
  );
}

/** Clean status indicator during build/generation. */
export function BuildStatusIndicator({ phaseLabel, hint }: { phaseLabel: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/20 animate-pulse" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <LoadingSpinner size="lg" className="text-primary relative z-10" />
      </div>
      <span className="typo-body text-foreground font-medium">{phaseLabel}</span>
      {hint && <p className="typo-caption text-foreground text-center leading-relaxed">{hint}</p>}
    </div>
  );
}

/** Active build progress — shows phase, completeness ring, active cells, and CLI output. */
export function ActiveBuildProgress({
  buildPhase, cellStates, onOpenNextQuestion, buildActivity, onSubmitAnswers,
}: {
  buildPhase?: BuildPhase;
  completeness?: number;
  cellStates?: Record<string, string>;
  cliOutputLines?: string[];
  onOpenNextQuestion?: () => void;
  buildActivity?: string | null;
  /** Submit all collected answers at once */
  onSubmitAnswers?: () => void;
}) {
  const { t, tx } = useTranslation();
  // Map BuildPhase keys to t.templates.matrix.* keys (key names differ — see below).
  const PHASE_TO_I18N: Record<string, string> = {
    initializing: t.templates.matrix.preparing,
    analyzing: t.templates.matrix.analyzing,
    resolving: t.templates.matrix.building,
    awaiting_input: t.templates.matrix.waiting_input,
    draft_ready: t.templates.matrix.draft_ready,
    testing: t.templates.matrix.testing,
    test_complete: t.templates.matrix.test_complete,
    promoted: t.templates.matrix.promoted,
    failed: t.templates.matrix.build_failed,
  };
  const phaseLabel = PHASE_TO_I18N[buildPhase ?? 'analyzing'] ?? t.templates.matrix.analyzing;
  const isAwaitingInput = buildPhase === 'awaiting_input';
  const pendingAnswerCount = useAgentStore((s) => Object.keys(s.buildPendingAnswers).length);

  const highlightedCellKeys = cellStates
    ? Object.entries(cellStates)
        .filter(([, status]) => status === 'highlighted')
        .map(([key]) => key)
    : [];
  const highlightedCells = highlightedCellKeys.map((key) => CELL_FRIENDLY_NAMES[key] ?? key);
  const activeCells = cellStates
    ? Object.entries(cellStates)
        .filter(([, status]) => status === 'filling' || status === 'pending')
        .map(([key]) => CELL_FRIENDLY_NAMES[key] ?? key)
    : [];
  const resolvedCells = cellStates
    ? Object.values(cellStates).filter((s) => s === 'resolved' || s === 'updated').length
    : 0;
  const totalCells = 8;
  // Don't show "All Resolved" during active processing phases — the CLI is still working
  const isActivelyProcessing = buildPhase === 'resolving' || buildPhase === 'analyzing';
  const allResolved = resolvedCells === totalCells && !isActivelyProcessing;

  // Has remaining unanswered questions?
  const hasUnansweredQuestions = highlightedCells.length > 0;
  // All questions answered (pending answers collected) but not yet submitted?
  const allQuestionsAnswered = pendingAnswerCount > 0 && !hasUnansweredQuestions;

  return (
    <div className="flex flex-col items-center gap-2.5 w-full h-full justify-center">
      {/* All questions answered → show Continue Build button */}
      {isAwaitingInput && allQuestionsAnswered && onSubmitAnswers ? (
        <button
          type="button"
          onClick={onSubmitAnswers}
          data-testid="continue-build-btn"
          className="flex items-center gap-2 px-5 py-3 rounded-modal bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-elevation-3 shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
        >
          <Play className="w-4 h-4" />
          <span className="text-sm font-semibold">{t.templates.matrix.continue_build}</span>
        </button>
      ) : allResolved ? (
        <div className="w-12 h-12 rounded-modal bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
      ) : isAwaitingInput && hasUnansweredQuestions ? (
        <button
          type="button"
          onClick={onOpenNextQuestion}
          data-testid={`answer-button-${highlightedCellKeys[0]}`}
          className="flex items-center gap-2 px-4 py-2.5 rounded-modal bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
          <span className="text-sm font-medium">{tx(t.templates.matrix.answer_cell, { cell: highlightedCells[0] ?? '' })}</span>
        </button>
      ) : (
        <div className="w-10 h-10 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
          <LoadingSpinner size="lg" className="text-primary/50" />
        </div>
      )}

      {/* Progress dots */}
      <div className="flex items-center gap-1">
        {Array.from({ length: totalCells }).map((_, i) => (
          <div key={i} className={`w-2 h-2 rounded-full transition-colors duration-500 ${i < resolvedCells ? 'bg-emerald-400' : 'bg-primary/15'}`} />
        ))}
      </div>

      {/* Phase label */}
      {allResolved ? (
        <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">
          {t.templates.matrix.all_resolved}
        </span>
      ) : allQuestionsAnswered ? (
        <span className="text-xs font-semibold text-emerald-400/80 tracking-wide uppercase">
          {tx(t.templates.matrix.answers_ready, { count: pendingAnswerCount })}
        </span>
      ) : (
        <span className="text-xs font-semibold text-foreground tracking-wide uppercase">
          {buildActivity || phaseLabel}
        </span>
      )}

      {/* Hint: which cells still need answers */}
      {isAwaitingInput && hasUnansweredQuestions && pendingAnswerCount > 0 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed">
          {tx(t.templates.matrix.answer_progress, { answered: pendingAnswerCount, remaining: highlightedCells.length })}
        </p>
      )}
      {isAwaitingInput && hasUnansweredQuestions && pendingAnswerCount === 0 && highlightedCells.length > 1 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed">
          {tx(t.templates.matrix.answer_progress, { answered: 0, remaining: highlightedCells.length })}
        </p>
      )}

      {!isAwaitingInput && activeCells.length > 0 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed animate-pulse">
          {tx(t.templates.matrix.working_on, { cells: activeCells.join(', ') })}
        </p>
      )}
    </div>
  );
}

/** Awaiting questions state. */
export function AwaitingQuestionsIndicator({ questionCount, onOpenQuestions }: { questionCount: number; onOpenQuestions: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <HelpCircle className="w-5 h-5 text-primary relative z-10" />
      </div>
      <span className="text-sm text-foreground font-medium">{t.templates.matrix.input_needed}</span>
      <button type="button" onClick={onOpenQuestions}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-modal bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
        <HelpCircle className="w-3.5 h-3.5" />
        Answer {questionCount} question{questionCount !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

/** Build completed state (adoption). */
export function BuildCompletedIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-emerald-400/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/15 via-emerald-500/8 to-emerald-400/10" />
        <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
      </div>
      <span className="text-sm text-foreground font-medium">{t.templates.matrix.build_complete}</span>
    </div>
  );
}

/** SVG completeness ring for creation mode. */
export function CompletenessRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? 'stroke-emerald-400' : 'stroke-primary';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-primary/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
          className={`${color} transition-all duration-700 ease-out`}
          strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="absolute text-xs font-bold text-foreground">{value}%</span>
    </div>
  );
}

/** Post-generation state for creation mode. */
export function CreationPostGeneration({
  completeness: _completeness, onRefine, onStartTest, onApplyEdits, onDiscardEdits, onSaveVersion,
}: {
  completeness: number;
  onRefine?: (feedback: string) => void;
  onStartTest?: () => void;
  /** Apply inline cell edits via CLI refine (--continue session) */
  onApplyEdits?: () => void;
  /** Discard inline cell edits */
  onDiscardEdits?: () => void;
  /** Save current state as a new persona version (saved variant) */
  onSaveVersion?: () => void;
}) {
  const { t, tx } = useTranslation();
  const [refineText, setRefineText] = useState('');
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const isTesting = buildPhase === 'testing';
  const editDirty = useAgentStore((s) => s.buildEditDirty);
  const editingCellKey = useAgentStore((s) => s.editingCellKey);

  const handleTest = () => {
    if (!onStartTest || isTesting) return;
    onStartTest();
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full h-full justify-center">
      <span className="text-xs font-semibold text-foreground tracking-wide uppercase">
        {editingCellKey ? tx(t.templates.matrix.editing_cell, { cell: CELL_FRIENDLY_NAMES[editingCellKey] ?? editingCellKey }) : t.templates.matrix.draft_ready_label}
      </span>

      {/* Apply/Discard bar when edits are pending */}
      {editDirty && onApplyEdits && (
        <div className="w-full flex gap-1.5">
          <button
            type="button"
            onClick={onApplyEdits}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-card text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t.templates.matrix.apply_changes}
          </button>
          {onDiscardEdits && (
            <button
              type="button"
              onClick={onDiscardEdits}
              className="px-2.5 py-1.5 rounded-card text-[11px] text-foreground hover:text-foreground/70 transition-colors"
            >
              Discard
            </button>
          )}
        </div>
      )}

      {onStartTest && !editDirty && (
        <button
          type="button"
          onClick={handleTest}
          disabled={isTesting}
          data-testid="agent-test-btn"
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-modal text-sm font-medium transition-all cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-elevation-3 shadow-emerald-500/20 hover:shadow-emerald-500/30"
        >
          {isTesting ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
          {isTesting ? t.templates.matrix.starting_test : t.templates.matrix.test_agent}
        </button>
      )}

      {onSaveVersion && !editDirty && (
        <button
          type="button"
          onClick={onSaveVersion}
          data-testid="save-version-btn"
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-modal text-sm font-medium transition-all cursor-pointer bg-gradient-to-r from-violet-500 to-indigo-500 text-white shadow-elevation-3 shadow-violet-500/20 hover:shadow-violet-500/30"
        >
          <Save className="w-3.5 h-3.5" />
          {t.templates.matrix_cmd.save_version}
        </button>
      )}

      {onRefine && !editDirty && (
        <div className="w-full flex gap-1.5">
          <textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder={t.templates.matrix_cmd.adjust_placeholder}
            data-testid="agent-refine-input"
            rows={3}
            className="flex-1 px-2.5 py-1.5 rounded-card border border-primary/15 bg-card-bg text-sm text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors resize-none"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && refineText.trim()) { e.preventDefault(); onRefine(refineText.trim()); setRefineText(''); } }}
          />
          <button
            type="button"
            onClick={() => { if (refineText.trim()) { onRefine(refineText.trim()); setRefineText(''); } }}
            disabled={!refineText.trim()}
            className="p-1.5 rounded-card text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors self-end"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** CLI output viewer during generation (scrolls to bottom). */
export function CliOutputStream({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length]);
  if (lines.length === 0) return null;
  return (
    <div ref={containerRef} className="w-full max-h-28 overflow-y-auto rounded-card bg-black/20 border border-primary/10 px-2 py-1.5 font-mono text-[11px] text-foreground leading-relaxed">
      {lines.slice(-30).map((line, i) => (
        <div key={i} className="truncate">{line}</div>
      ))}
    </div>
  );
}

/** Design question prompt for creation mode. */
export function DesignQuestionPrompt({ question, onAnswer }: { question: DesignQuestion; onAnswer: (answer: string) => void }) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState('');
  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <HelpCircle className="w-5 h-5 text-primary relative z-10" />
      </div>
      <p className="text-sm text-foreground text-center leading-snug">{question.question}</p>
      {question.options && question.options.length > 0 ? (
        <div className="w-full space-y-1.5">
          {question.options.map((opt, i) => (
            <button key={i} type="button" onClick={() => onAnswer(opt)}
              className="w-full px-3 py-2 rounded-card border border-primary/15 bg-card-bg text-sm text-foreground hover:bg-primary/5 hover:border-primary/25 transition-colors text-left">
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="w-full flex gap-1.5">
          <input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t.templates.matrix_variants.your_answer_placeholder}
            className="flex-1 px-2.5 py-1.5 rounded-card border border-primary/15 bg-card-bg text-sm text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim()) { onAnswer(answer.trim()); setAnswer(''); } }} />
          <button type="button" onClick={() => { if (answer.trim()) { onAnswer(answer.trim()); setAnswer(''); } }}
            disabled={!answer.trim()} className="p-1.5 rounded-card text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Test running indicator -- streaming output + cancel button. */
export function TestRunningIndicator({ testOutputLines = [], onCancelTest }: { testOutputLines?: string[]; onCancelTest?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <BuildStatusIndicator phaseLabel="Testing agent..." />
      <p className="text-xs text-foreground text-center leading-relaxed max-w-xs">
        {t.templates.matrix_variants.testing_background_hint}
      </p>
      {testOutputLines.length > 0 && (
        <CliOutputStream lines={testOutputLines} />
      )}
      {onCancelTest && (
        <button
          type="button"
          onClick={onCancelTest}
          className="text-xs text-foreground hover:text-muted-foreground/70 transition-colors"
        >
          {t.templates.matrix_variants.cancel_test}
        </button>
      )}
    </div>
  );
}

/** Test results panel -- pass/fail summary with View Report button. */
export function TestResultsPanel({
  passed, error, onApprove, onApproveAnyway, onReject, onRefine, onDeleteDraft, toolResults = [], summary,
}: {
  passed?: boolean | null;
  outputLines?: string[];
  error?: string | null;
  onApprove?: () => void;
  /** Force-promote bypass when tests didn't pass (skipped / failed / connector gaps). */
  onApproveAnyway?: () => void;
  onReject?: () => void;
  /** Rebuild with refinement feedback → re-test. */
  onRefine?: (feedback: string) => void;
  /** Discard the draft and close — shown when tests didn't fully pass. */
  onDeleteDraft?: () => void;
  toolResults?: ToolTestResult[];
  summary?: string | null;
}) {
  const { t } = useTranslation();
  const [showReport, setShowReport] = useState(false);
  const [refineText, setRefineText] = useState('');
  const testConnectors = useAgentStore((s) => s.buildTestConnectors);
  const missingConnectors = testConnectors.filter((c) => !c.has_credential);
  const hasConnectorGaps = missingConnectors.length > 0;
  // Block approval if connectors lack credentials, even if tools somehow passed
  const didPass = passed === true && !hasConnectorGaps;
  const passedCount = toolResults.filter((r) => r.status === 'passed').length;
  const failedCount = toolResults.filter((r) => r.status === 'failed' || r.status === 'credential_missing').length;
  const skippedCount = toolResults.filter((r) => r.status === 'skipped').length;

  return (
    <div className="relative flex flex-col gap-2 py-2 w-full h-full justify-center">
      {/* Status icon — absolute top-right */}
      <div className="absolute top-1 right-1 z-10">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border ${
          didPass ? 'border-emerald-400/30 bg-emerald-500/10' : failedCount > 0 ? 'border-red-400/30 bg-red-500/10' : 'border-amber-400/30 bg-amber-500/10'
        }`}>
          {didPass
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : failedCount > 0
            ? <XCircle className="w-4 h-4 text-red-400" />
            : <AlertTriangle className="w-4 h-4 text-amber-400" />}
        </div>
      </div>

      {/* Compact status + counts */}
      <div className="flex items-center gap-2 pr-8">
        <span className={`text-sm font-medium ${didPass ? 'text-emerald-400' : failedCount > 0 ? 'text-red-400' : 'text-amber-400'}`}>
          {didPass ? 'Tests Passed' : failedCount > 0 ? 'Tests Failed' : 'Skipped'}
        </span>
        {toolResults.length > 0 && (
          <span className="text-sm text-foreground">
            {passedCount > 0 && <span className="text-emerald-400/70">{passedCount}</span>}
            {failedCount > 0 && <>{passedCount > 0 && '/'}<span className="text-red-400/70">{failedCount}</span></>}
            {skippedCount > 0 && <>{(passedCount > 0 || failedCount > 0) && '/'}<span className="text-foreground">{skippedCount}</span></>}
          </span>
        )}
      </div>

      {error && !toolResults.length && (
        <p className="text-sm text-red-400/80 leading-snug">{error}</p>
      )}

      {hasConnectorGaps && (
        <p className="text-sm text-amber-400/80 leading-snug">
          {t.templates.matrix_variants.missing_keys} <strong>{missingConnectors.map((c) => c.name).join(', ')}</strong>
        </p>
      )}

      {/* Refinement input — shown when tests didn't pass so user can describe
          what changed (e.g. "Added Alpha Vantage key") before retrying. */}
      {!didPass && onRefine && (
        <input
          type="text"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && refineText.trim()) {
              e.preventDefault();
              onRefine(refineText.trim());
              setRefineText('');
            }
          }}
          placeholder={t.templates.matrix_variants.refine_placeholder}
          className="w-full px-3 py-1.5 typo-body rounded-lg border border-primary/15 bg-white/[0.03] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/30 transition-all"
        />
      )}

      {/* Action buttons — single row */}
      <div className="flex gap-2 w-full">
        {didPass && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            data-testid="agent-approve-btn"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-modal text-sm font-medium cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-elevation-3 shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve
          </button>
        )}
        {!didPass && onApproveAnyway && (
          <button
            type="button"
            onClick={onApproveAnyway}
            data-testid="agent-approve-anyway-btn"
            title={hasConnectorGaps
              ? `Promote without credentials for: ${missingConnectors.map((c) => c.name).join(', ')}`
              : 'Promote this agent despite skipped or failed tests'}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-modal typo-body font-medium cursor-pointer bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-white shadow-elevation-2 shadow-amber-500/20 hover:shadow-amber-500/30 hover:from-amber-500 hover:to-orange-500 transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.approve_anyway}
          </button>
        )}
        {(toolResults.length > 0 || error) && (
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-primary/15 text-foreground hover:bg-primary/5 hover:text-foreground/80 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Report
          </button>
        )}
        {onReject && (
          <button
            type="button"
            onClick={() => {
              if (refineText.trim() && onRefine) {
                onRefine(refineText.trim());
                setRefineText('');
              } else {
                onReject();
              }
            }}
            data-testid="agent-reject-btn"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-primary/15 text-foreground hover:bg-primary/5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.retry_with_changes}
          </button>
        )}
        {!didPass && onDeleteDraft && (
          <button
            type="button"
            onClick={onDeleteDraft}
            data-testid="agent-delete-draft-btn"
            title={t.templates.matrix_variants.delete_draft_title}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-red-500/20 text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.delete_draft}
          </button>
        )}
      </div>

      {showReport && createPortal(
        <TestReportModal results={toolResults} summary={summary} onClose={() => setShowReport(false)} onCredentialAdded={onReject} />,
        document.body,
      )}
    </div>
  );
}

// TestReportModal and all its helpers (parseReportSections, ConnectorHandshakeCard,
// ReportOverview, MarkdownLine, ToolDetailView, CopyButton, FormattedPreview,
// httpStatusHint, formatErrorForUser) have been extracted to TestReportModal.tsx.
// The following marker prevents accidental re-addition.
// --- TestReportModal + helpers extracted to TestReportModal.tsx ---
/** Promotion success indicator -- checkmark with emerald glow. */
export function PromotionSuccessIndicator({ onViewAgent }: { onViewAgent?: () => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="promotion-success" className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-emerald-400/30 shadow-[0_0_16px_rgba(52,211,153,0.2)] animate-emerald-flash" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-teal-400/15" />
        <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
      </div>
      <span className="typo-body text-foreground font-medium">{t.templates.matrix_variants.agent_promoted}</span>
      {onViewAgent && (
        <button
          type="button"
          onClick={onViewAgent}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-modal border border-primary/15 typo-body text-foreground hover:bg-primary/5 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {t.templates.matrix_variants.view_agent}
        </button>
      )}
    </div>
  );
}
