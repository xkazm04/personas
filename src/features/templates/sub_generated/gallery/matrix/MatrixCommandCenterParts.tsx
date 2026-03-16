/**
 * MatrixCommandCenterParts -- extracted sub-components for MatrixCommandCenter.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, X, Loader2, HelpCircle, CheckCircle2, Send, RefreshCw,
  XCircle, Eye, RotateCcw, FileText, Clock, AlertTriangle, Key,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { DesignQuestion } from '@/lib/types/designTypes';
import type { BuildPhase, ToolTestResult } from '@/lib/types/buildTypes';
import { useAgentStore } from '@/stores/agentStore';

interface PromptSection { key: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string; content: string; }

// -- Constants ----------------------------------------------------------------

/** Human-readable labels for build phases. */
export const BUILD_PHASE_LABELS: Record<string, string> = {
  initializing: 'Preparing build...',
  analyzing: 'Analyzing your intent...',
  resolving: 'Building agent dimensions...',
  awaiting_input: 'Waiting for your input...',
  draft_ready: 'Draft ready for review',
  testing: 'Testing agent...',
  test_complete: 'Test complete',
  promoted: 'Agent promoted',
  failed: 'Build failed',
};

/** Human-readable cell key labels. */
export const CELL_FRIENDLY_NAMES: Record<string, string> = {
  'use-cases': 'Tasks',
  'connectors': 'Apps & Services',
  'triggers': 'When It Runs',
  'human-review': 'Human Review',
  'memory': 'Memory',
  'error-handling': 'Error Handling',
  'messages': 'Messages',
  'events': 'Events',
};

/** Phase sub-text descriptions. */
export const PHASE_SUBTEXT: Record<string, string> = {
  analyzing: 'Understanding your intent...',
  resolving: 'Building agent configuration...',
  awaiting_input: 'Your input is needed — click a highlighted dimension',
  draft_ready: 'All dimensions resolved — ready for testing',
};

/** LaunchOrb lifecycle glow mapping. */
export const ORB_GLOW_CLASSES: Record<string, string> = {
  idle: '',
  initializing: '',
  analyzing: '',
  resolving: '',
  generating: 'shadow-[0_0_24px_var(--primary)]',
  awaiting_input: 'shadow-[0_0_16px_var(--primary)] animate-glow-breathe',
  draft_ready: 'shadow-[0_0_20px_theme(colors.emerald.400)]',
  testing: '',
  test_complete: 'shadow-[0_0_16px_theme(colors.emerald.400)]',
  promoted: 'shadow-[0_0_20px_theme(colors.emerald.400)] animate-emerald-flash',
  failed: '',
};

// -- Components ---------------------------------------------------------------

export function PromptModal({ section, onClose }: { section: PromptSection; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);
  const Icon = section.icon;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5"><Icon className={`w-4.5 h-4.5 ${section.color}`} /><h3 className="text-base font-semibold text-foreground/90">{section.label}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-foreground/[0.04] transition-colors"><X className="w-4 h-4 text-muted-foreground/60" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap text-sm text-foreground/80 font-sans leading-relaxed">{section.content}</pre></div>
      </div>
    </div>,
    document.body,
  );
}

export function CapabilityToggle({ icon: Icon, label, active, onToggle }: { icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={[
      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
      active
        ? 'border-primary/30 bg-primary/15 text-primary'
        : 'border-primary/10 bg-transparent text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-primary/20',
    ].join(' ')}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
  );
}

/** Radial launch orb -- the visual centerpiece of the matrix. */
export function LaunchOrb({ onClick, disabled, isRunning, label, icon, buildPhase }: { onClick?: () => void; disabled: boolean; isRunning: boolean; label: string; icon?: React.ReactNode; buildPhase?: BuildPhase }) {
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
          ? <Loader2 className="w-6 h-6 text-primary animate-spin relative z-10" />
          : icon ?? <Play className={`w-6 h-6 relative z-10 transition-colors ${
              blocked ? 'text-orange-600/60 dark:text-amber-500/50' : 'text-primary/80 group-hover:text-primary'
            }`} />}
      </button>
      <span className={`text-[11px] font-medium tracking-wide uppercase ${
        blocked ? 'text-orange-600/70 dark:text-amber-500/60' : 'text-muted-foreground/50'
      }`}>
        {isRunning ? 'Generating...' : label}
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
        <Loader2 className="w-5 h-5 text-primary animate-spin relative z-10" />
      </div>
      <span className="text-sm text-foreground/60 font-medium">{phaseLabel}</span>
      {hint && <p className="text-xs text-muted-foreground/40 text-center leading-relaxed">{hint}</p>}
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
  const phaseLabel = BUILD_PHASE_LABELS[buildPhase ?? 'analyzing'] ?? 'Building...';
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
  const allResolved = resolvedCells === totalCells;

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
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
        >
          <Play className="w-4 h-4" />
          <span className="text-sm font-semibold">Continue Build</span>
        </button>
      ) : allResolved ? (
        <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
      ) : isAwaitingInput && hasUnansweredQuestions ? (
        <button
          type="button"
          onClick={onOpenNextQuestion}
          data-testid={`answer-button-${highlightedCellKeys[0]}`}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Answer: {highlightedCells[0]}</span>
        </button>
      ) : (
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-primary/50 animate-spin" />
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
          All Dimensions Resolved
        </span>
      ) : allQuestionsAnswered ? (
        <span className="text-xs font-semibold text-emerald-400/80 tracking-wide uppercase">
          {pendingAnswerCount} answer{pendingAnswerCount > 1 ? 's' : ''} ready — click Continue
        </span>
      ) : (
        <span className="text-xs font-semibold text-foreground/70 tracking-wide uppercase">
          {buildActivity || phaseLabel}
        </span>
      )}

      {/* Hint: which cells still need answers */}
      {isAwaitingInput && hasUnansweredQuestions && pendingAnswerCount > 0 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed">
          {pendingAnswerCount} answered, {highlightedCells.length} remaining
        </p>
      )}
      {isAwaitingInput && hasUnansweredQuestions && pendingAnswerCount === 0 && highlightedCells.length > 1 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed">
          {highlightedCells.length} questions — answer all, then Continue
        </p>
      )}

      {!isAwaitingInput && activeCells.length > 0 && (
        <p className="text-[10px] text-primary/60 text-center leading-relaxed animate-pulse">
          Working on: {activeCells.join(', ')}
        </p>
      )}
    </div>
  );
}

/** Awaiting questions state. */
export function AwaitingQuestionsIndicator({ questionCount, onOpenQuestions }: { questionCount: number; onOpenQuestions: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <HelpCircle className="w-5 h-5 text-primary relative z-10" />
      </div>
      <span className="text-sm text-foreground/70 font-medium">Your input needed</span>
      <button type="button" onClick={onOpenQuestions}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
        <HelpCircle className="w-3.5 h-3.5" />
        Answer {questionCount} question{questionCount !== 1 ? 's' : ''}
      </button>
    </div>
  );
}

/** Build completed state (adoption). */
export function BuildCompletedIndicator() {
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-emerald-400/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/15 via-emerald-500/8 to-emerald-400/10" />
        <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
      </div>
      <span className="text-sm text-foreground/70 font-medium">Build Complete</span>
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
      <span className="absolute text-xs font-bold text-foreground/70">{value}%</span>
    </div>
  );
}

/** Post-generation state for creation mode. */
export function CreationPostGeneration({
  completeness, onRefine, onStartTest, onApplyEdits, onDiscardEdits,
}: {
  completeness: number;
  onRefine?: (feedback: string) => void;
  onStartTest?: () => void;
  /** Apply inline cell edits via CLI refine (--continue session) */
  onApplyEdits?: () => void;
  /** Discard inline cell edits */
  onDiscardEdits?: () => void;
}) {
  const [refineText, setRefineText] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const editDirty = useAgentStore((s) => s.buildEditDirty);
  const editingCellKey = useAgentStore((s) => s.editingCellKey);

  const handleTest = async () => {
    if (!onStartTest || isTesting) return;
    setIsTesting(true);
    try {
      await onStartTest();
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full h-full justify-center">
      <CompletenessRing value={completeness} />

      <span className="text-xs font-semibold text-foreground/70 tracking-wide uppercase">
        {editingCellKey ? `Editing: ${CELL_FRIENDLY_NAMES[editingCellKey] ?? editingCellKey}` : 'Draft Ready'}
      </span>

      {/* Inline edit hint */}
      {!editDirty && !editingCellKey && (
        <p className="text-[10px] text-muted-foreground/40 text-center">Click any cell to adjust</p>
      )}

      {/* Apply/Discard bar when edits are pending */}
      {editDirty && onApplyEdits && (
        <div className="w-full flex gap-1.5">
          <button
            type="button"
            onClick={onApplyEdits}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Apply Changes
          </button>
          {onDiscardEdits && (
            <button
              type="button"
              onClick={onDiscardEdits}
              className="px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground/50 hover:text-foreground/70 transition-colors"
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
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
        >
          {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isTesting ? 'Starting Test...' : 'Test Agent'}
        </button>
      )}

      {onRefine && !editDirty && (
        <div className="w-full flex gap-1.5">
          <input
            type="text"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="Adjust anything..."
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            onKeyDown={(e) => { if (e.key === 'Enter' && refineText.trim()) { onRefine(refineText.trim()); setRefineText(''); } }}
          />
          <button
            type="button"
            onClick={() => { if (refineText.trim()) { onRefine(refineText.trim()); setRefineText(''); } }}
            disabled={!refineText.trim()}
            className="p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors"
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
    <div ref={containerRef} className="w-full max-h-28 overflow-y-auto rounded-lg bg-black/20 border border-primary/10 px-2 py-1.5 font-mono text-[11px] text-muted-foreground/60 leading-relaxed">
      {lines.slice(-30).map((line, i) => (
        <div key={i} className="truncate">{line}</div>
      ))}
    </div>
  );
}

/** Design question prompt for creation mode. */
export function DesignQuestionPrompt({ question, onAnswer }: { question: DesignQuestion; onAnswer: (answer: string) => void }) {
  const [answer, setAnswer] = useState('');
  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/25" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <HelpCircle className="w-5 h-5 text-primary relative z-10" />
      </div>
      <p className="text-sm text-foreground/80 text-center leading-snug">{question.question}</p>
      {question.options && question.options.length > 0 ? (
        <div className="w-full space-y-1.5">
          {question.options.map((opt, i) => (
            <button key={i} type="button" onClick={() => onAnswer(opt)}
              className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 hover:bg-primary/5 hover:border-primary/25 transition-colors text-left">
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="w-full flex gap-1.5">
          <input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer..."
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-primary/15 bg-card-bg text-sm text-foreground/80 placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            onKeyDown={(e) => { if (e.key === 'Enter' && answer.trim()) { onAnswer(answer.trim()); setAnswer(''); } }} />
          <button type="button" onClick={() => { if (answer.trim()) { onAnswer(answer.trim()); setAnswer(''); } }}
            disabled={!answer.trim()} className="p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 disabled:text-muted-foreground/20 transition-colors">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Test running indicator -- streaming output + cancel button. */
export function TestRunningIndicator({ testOutputLines = [], onCancelTest }: { testOutputLines?: string[]; onCancelTest?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <BuildStatusIndicator phaseLabel="Testing agent..." />
      {testOutputLines.length > 0 && (
        <CliOutputStream lines={testOutputLines} />
      )}
      {onCancelTest && (
        <button
          type="button"
          onClick={onCancelTest}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
        >
          Cancel Test
        </button>
      )}
    </div>
  );
}

/** Test results panel -- pass/fail summary with View Report button. */
export function TestResultsPanel({
  passed, error, onApprove, onReject, toolResults = [], summary,
}: {
  passed?: boolean | null;
  outputLines?: string[];
  error?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  toolResults?: ToolTestResult[];
  summary?: string | null;
}) {
  const [showReport, setShowReport] = useState(false);
  const didPass = passed === true;
  const passedCount = toolResults.filter((r) => r.status === 'passed').length;
  const failedCount = toolResults.filter((r) => r.status === 'failed' || r.status === 'credential_missing').length;
  const skippedCount = toolResults.filter((r) => r.status === 'skipped').length;

  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className={`absolute inset-0 rounded-full border-2 ${didPass ? 'border-emerald-400/25' : 'border-red-400/25'}`} />
        <span className={`absolute inset-[3px] rounded-full bg-gradient-to-br ${
          didPass
            ? 'from-emerald-500/15 via-emerald-500/8 to-emerald-400/10'
            : 'from-red-500/15 via-red-500/8 to-red-400/10'
        }`} />
        {didPass
          ? <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
          : <XCircle className="w-5 h-5 text-red-400 relative z-10" />}
      </div>

      <span className={`text-sm font-medium ${didPass ? 'text-emerald-400' : 'text-red-400'}`}>
        {didPass ? 'All Tests Passed' : 'Some Tests Failed'}
      </span>

      {/* Brief summary */}
      {toolResults.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
          {passedCount > 0 && <span className="text-emerald-400">{passedCount} passed</span>}
          {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
          {skippedCount > 0 && <span className="text-muted-foreground/40">{skippedCount} skipped</span>}
        </div>
      )}

      {error && !toolResults.length && (
        <p className="text-xs text-red-400/80 text-center leading-relaxed px-2">{error}</p>
      )}

      {/* View Report button */}
      {toolResults.length > 0 && (
        <button
          type="button"
          onClick={() => setShowReport(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-primary/15 text-foreground/60 hover:bg-primary/5 hover:text-foreground/80 transition-colors"
        >
          <FileText className="w-3 h-3" />
          View Report
        </button>
      )}

      <div className="flex gap-2 w-full">
        {didPass && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve
          </button>
        )}
        {onReject && (
          <button
            type="button"
            onClick={onReject}
            className={`${didPass ? 'flex-1' : 'w-full'} flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-primary/15 text-foreground/70 hover:bg-primary/5 transition-colors`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {didPass ? 'Try Again' : 'Refine & Retry'}
          </button>
        )}
      </div>

      {showReport && createPortal(
        <TestReportModal results={toolResults} summary={summary} onClose={() => setShowReport(false)} />,
        document.body,
      )}
    </div>
  );
}

/** Split-pane modal: left = test scope (per-tool results), right = LLM-generated summary. */
function TestReportModal({ results, summary, onClose }: { results: ToolTestResult[]; summary?: string | null; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, true, onClose);

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed' || r.status === 'credential_missing').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const allPassed = failedCount === 0 && passedCount > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div
        ref={modalRef}
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-primary/15 bg-background shadow-2xl shadow-black/30 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/[0.03]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              allPassed
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-red-500/10 border-red-500/20'
            }`}>
              {allPassed
                ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                : <XCircle className="w-4.5 h-4.5 text-red-400" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground/90">Test Report</h2>
              <div className="flex items-center gap-3 mt-0.5">
                {passedCount > 0 && (
                  <span className="text-xs text-emerald-400 font-medium">{passedCount} passed</span>
                )}
                {failedCount > 0 && (
                  <span className="text-xs text-red-400 font-medium">{failedCount} failed</span>
                )}
                {skippedCount > 0 && (
                  <span className="text-xs text-muted-foreground/50">{skippedCount} skipped</span>
                )}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground/60" />
          </button>
        </div>

        {/* Split content: left = scope, right = analysis */}
        <div className="flex-1 min-h-0 flex">
          {/* Left pane: Test Scope */}
          <div className="w-1/2 border-r border-primary/10 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-primary/5 bg-secondary/10">
              <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Test Scope</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {results.map((r, i) => (
                <ToolTestResultRow key={i} result={r} />
              ))}
            </div>
          </div>

          {/* Right pane: Analysis */}
          <div className="w-1/2 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-primary/5 bg-secondary/10">
              <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Analysis</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {summary ? (
                <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                  {summary}
                </p>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                  <Loader2 className="w-5 h-5 text-muted-foreground/30 animate-spin" />
                  <p className="text-sm text-muted-foreground/40">Generating analysis...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Single tool test result row inside the report modal. */
function ToolTestResultRow({ result }: { result: ToolTestResult }) {
  const statusConfig = {
    passed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/15', label: 'Passed' },
    failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/15', label: 'Failed' },
    credential_missing: { icon: Key, color: 'text-amber-400', bg: 'bg-amber-500/8', border: 'border-amber-500/15', label: 'Needs Credential' },
    skipped: { icon: AlertTriangle, color: 'text-muted-foreground/40', bg: 'bg-secondary/20', border: 'border-primary/10', label: 'Skipped' },
  }[result.status] ?? { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/15', label: result.status };

  const StatusIcon = statusConfig.icon;
  const toolLabel = result.tool_name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className={`rounded-lg border ${statusConfig.border} ${statusConfig.bg} px-3 py-2.5`}>
      <div className="flex items-center gap-2">
        <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusConfig.color}`} />
        <span className="text-[13px] font-medium text-foreground/80 truncate flex-1">{toolLabel}</span>
        {result.http_status && (
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            result.http_status >= 200 && result.http_status < 300
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {result.http_status}
          </span>
        )}
        {result.latency_ms != null && result.latency_ms > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/30 flex-shrink-0">
            <Clock className="w-2.5 h-2.5" />
            {result.latency_ms}ms
          </span>
        )}
      </div>
      {result.connector && (
        <span className="text-[10px] text-muted-foreground/35 ml-5.5 block mt-0.5">via {result.connector}</span>
      )}
    </div>
  );
}

/** Promotion success indicator -- checkmark with emerald glow. */
export function PromotionSuccessIndicator({ onViewAgent }: { onViewAgent?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-emerald-400/30 shadow-[0_0_16px_rgba(52,211,153,0.2)] animate-emerald-flash" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-teal-400/15" />
        <CheckCircle2 className="w-5 h-5 text-emerald-400 relative z-10" />
      </div>
      <span className="text-sm text-foreground/70 font-medium">Agent Promoted</span>
      {onViewAgent && (
        <button
          type="button"
          onClick={onViewAgent}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/15 text-sm text-foreground/70 hover:bg-primary/5 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          View Agent
        </button>
      )}
    </div>
  );
}
