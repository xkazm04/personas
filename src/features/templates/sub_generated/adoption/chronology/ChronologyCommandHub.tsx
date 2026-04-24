/**
 * ChronologyCommandHub — shared command center for Chain and Wildcard prototypes.
 *
 * Single horizontal bar with phase pill + completeness + activity always visible.
 * Beneath it, an expandable drawer swaps content based on phase:
 *   draft_ready        → Start Test button
 *   testing            → streaming test output
 *   test_complete      → full TestResultsPanel (approve / approve-anyway / retry / delete)
 *   promoted           → View Agent
 *   awaiting_input     → inline pending-questions panel
 *
 * All reusable test UI is delegated to MatrixCommandCenterParts so the adoption
 * flow behaves identically across Matrix / Chain / Wildcard variants.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2, Play, Sparkles, ChevronDown, ChevronUp, Send, MessageCircle, Trash2,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BuildPhase, BuildQuestion, ToolTestResult } from '@/lib/types/buildTypes';
import {
  TestRunningIndicator,
  TestResultsPanel,
  PromotionSuccessIndicator,
} from '../../gallery/matrix/MatrixCommandCenterParts';
import { GlyphQuestionPanel } from '@/features/shared/glyph';

export interface ChronologyCommandHubProps {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  buildActivity?: string | null;

  // Build-time Q&A (mid-build refinement questions from the LLM)
  pendingQuestions?: BuildQuestion[];
  onAnswerBuildQuestion?: (cellKey: string, answer: string) => void;
  onSubmitAllAnswers?: () => void;

  // Lifecycle actions
  onStartTest?: () => void;
  onApproveTest?: () => void;
  onApproveTestAnyway?: () => void;
  onRejectTest?: () => void;
  onDeleteDraft?: () => void;
  onRefine?: (feedback: string) => void;
  onViewAgent?: () => void;

  // Test results
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  toolTestResults?: ToolTestResult[];
  testSummary?: string | null;
}

type PhaseLabelKey =
  | 'hub_phase_idle' | 'hub_phase_initializing' | 'hub_phase_analyzing'
  | 'hub_phase_awaiting_input' | 'hub_phase_resolving' | 'hub_phase_draft_ready'
  | 'hub_phase_testing' | 'hub_phase_test_complete' | 'hub_phase_completed'
  | 'hub_phase_promoted' | 'hub_phase_failed' | 'hub_phase_cancelled';

function phaseLabelKey(phase: BuildPhase | undefined): PhaseLabelKey {
  switch (phase) {
    case 'initializing': return 'hub_phase_initializing';
    case 'analyzing': return 'hub_phase_analyzing';
    case 'awaiting_input': return 'hub_phase_awaiting_input';
    case 'resolving': return 'hub_phase_resolving';
    case 'draft_ready': return 'hub_phase_draft_ready';
    case 'testing': return 'hub_phase_testing';
    case 'test_complete': return 'hub_phase_test_complete';
    case 'completed': return 'hub_phase_completed';
    case 'promoted': return 'hub_phase_promoted';
    case 'failed': return 'hub_phase_failed';
    case 'cancelled': return 'hub_phase_cancelled';
    default: return 'hub_phase_idle';
  }
}

/* ── Pending questions inline panel ────────────────────────────────────
 * Delegates to GlyphQuestionPanel (same component the build-from-scratch
 * Matrix/Glyph layouts use) so the adoption flow answers questions with
 * identical testids, styling, and vault-connector-picker routing — Matrix
 * and Glyph prototypes stay 1:1 for Q&A until one replaces the other.
 */

/* ── Draft ready refine panel ────────────────────────────────────────
 * Shown when the adoption draft is seeded and ready for testing but the
 * user wants to request changes first — mirrors the old Matrix
 * SavedRefineInput / BuildCompletedIndicator surface so users can rebuild
 * with feedback before running the test suite.
 */
function DraftReadyRefinePanel({
  onRefine, onStartTest, onDeleteDraft,
}: {
  onRefine: (feedback: string) => void;
  onStartTest?: () => void;
  onDeleteDraft?: () => void;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim()) return;
    onRefine(text.trim());
    setText('');
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-modal bg-primary/5 border border-primary/20 shadow-elevation-1">
      <div className="flex items-center gap-2">
        <div className="relative w-7 h-7 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full border-2 border-status-success/35" />
          <span className="absolute inset-[3px] rounded-full bg-status-success/15" />
          <MessageCircle className="w-3.5 h-3.5 text-status-success relative z-10" />
        </div>
        <div className="flex flex-col">
          <span className="typo-heading font-bold uppercase tracking-[0.12em] text-foreground">
            {c.hub_draft_ready_title}
          </span>
          <span className="typo-body text-foreground/80">
            {c.hub_draft_ready_subtitle}
          </span>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={c.hub_refine_placeholder}
        rows={2}
        className="w-full px-3 py-2 rounded-modal border border-card-border bg-card-bg typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 shadow-elevation-1 resize-none"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!text.trim()}
          onClick={submit}
          className="flex items-center gap-1.5 px-4 py-2 rounded-modal bg-primary/15 border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed typo-body font-semibold text-foreground shadow-elevation-2 cursor-pointer"
        >
          <Send className="w-4 h-4" /> {c.hub_refine_send}
        </button>
        {onStartTest && (
          <button
            type="button"
            onClick={onStartTest}
            className="flex items-center gap-1.5 px-4 py-2 rounded-modal bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white typo-body font-semibold shadow-elevation-3 shadow-emerald-500/25 cursor-pointer"
          >
            <Play className="w-4 h-4" /> {t.templates.matrix_variants.start_test}
          </button>
        )}
        {onDeleteDraft && (
          <button
            type="button"
            onClick={onDeleteDraft}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-modal border border-status-error/30 text-status-error hover:bg-status-error/10 typo-body font-medium cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> {c.hub_delete_draft}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────────── */

function HubTopBar({
  buildPhase, completeness = 0, isRunning, buildActivity,
  onStartTest, onViewAgent, expanded, onToggleExpand, showToggle,
}: {
  buildPhase?: BuildPhase;
  completeness?: number;
  isRunning?: boolean;
  buildActivity?: string | null;
  onStartTest?: () => void;
  onViewAgent?: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  showToggle: boolean;
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.min(100, Math.max(0, completeness)));
  const phaseKey = phaseLabelKey(buildPhase);
  const phaseText = t.templates.chronology[phaseKey];

  return (
    <div className="relative flex items-center gap-3 px-4 py-3 rounded-modal bg-card-bg border border-card-border shadow-elevation-2 overflow-hidden">
      {/* Subtle primary-tinted mesh behind the bar — matches Glass center hub */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 20% 50%, color-mix(in srgb, var(--primary) 6%, transparent) 0%, transparent 60%)' }}
      />
      {/* Light reflection */}
      <div
        className="absolute top-0 left-0 w-2/3 h-1/2 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }}
      />

      {/* Phase pill */}
      <div className="relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/25 shadow-elevation-1">
        {isRunning && <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin" />}
        <span className="typo-label font-bold uppercase tracking-[0.15em] text-foreground">
          {phaseText}
        </span>
      </div>

      {/* Completeness */}
      <div className="relative z-10 flex items-center gap-2 flex-1 min-w-0 max-w-[320px]">
        <span className="typo-label font-semibold tracking-[0.12em] text-foreground hidden md:inline">
          {t.templates.chronology.hub_completeness_label}
        </span>
        <div className="flex-1 h-2 rounded-full bg-primary/10 overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 60%, transparent), color-mix(in srgb, var(--primary) 35%, transparent))' }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
          />
        </div>
        <span className="typo-body font-bold text-foreground tabular-nums">{pct}%</span>
      </div>

      {/* Activity */}
      <div className="relative z-10 hidden lg:flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-modal bg-primary/5 border border-primary/15">
        <span className="flex gap-0.5 flex-shrink-0">
          <span className={`w-1 h-1 rounded-full ${isRunning ? 'bg-foreground animate-bounce' : 'bg-foreground/20'}`} style={{ animationDelay: '0ms' }} />
          <span className={`w-1 h-1 rounded-full ${isRunning ? 'bg-foreground animate-bounce' : 'bg-foreground/20'}`} style={{ animationDelay: '150ms' }} />
          <span className={`w-1 h-1 rounded-full ${isRunning ? 'bg-foreground animate-bounce' : 'bg-foreground/20'}`} style={{ animationDelay: '300ms' }} />
        </span>
        <span className="typo-body text-foreground truncate">
          {buildActivity || t.templates.chronology.hub_no_activity}
        </span>
      </div>

      {/* Inline actions for terminal states */}
      <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
        {onStartTest && buildPhase === 'draft_ready' && (
          <button
            onClick={onStartTest}
            className="flex items-center gap-1.5 px-4 py-2 rounded-modal bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white typo-body font-semibold shadow-elevation-3 shadow-emerald-500/25 cursor-pointer transition-all"
          >
            <Play className="w-4 h-4" /> {t.templates.matrix_variants.start_test}
          </button>
        )}
        {onViewAgent && (buildPhase === 'completed' || buildPhase === 'promoted') && (
          <button
            onClick={onViewAgent}
            className="flex items-center gap-1.5 px-4 py-2 rounded-modal bg-primary/15 border border-primary/25 hover:bg-primary/25 typo-body font-semibold text-foreground shadow-elevation-2 cursor-pointer transition-all"
          >
            <Sparkles className="w-4 h-4" /> {t.templates.matrix_variants.view_agent_btn}
          </button>
        )}
        {showToggle && (
          <button
            onClick={onToggleExpand}
            className="p-2 rounded-modal text-foreground/70 hover:text-foreground hover:bg-primary/10 border border-transparent hover:border-primary/15 cursor-pointer transition-colors"
            title={expanded ? t.templates.chronology.hub_details_hide : t.templates.chronology.hub_details_show}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main ──────────────────────────────────────────────────────────── */

function ChronologyCommandHubImpl(props: ChronologyCommandHubProps) {
  const { t } = useTranslation();
  const {
    buildPhase, completeness, isRunning, buildActivity,
    pendingQuestions = [], onAnswerBuildQuestion, onSubmitAllAnswers,
    onStartTest, onApproveTest, onApproveTestAnyway, onRejectTest, onDeleteDraft,
    onRefine, onViewAgent,
    testOutputLines = [], testPassed, testError, toolTestResults = [], testSummary,
  } = props;

  // Drawer logic — open by default for phases that need expanded real estate.
  // draft_ready only makes the drawer *available* (not auto-open) when refine is
  // wired, so users can request pre-test changes without blocking Start Test.
  const hasDraftRefine = buildPhase === 'draft_ready' && !!onRefine;
  const autoOpen =
    buildPhase === 'testing' ||
    buildPhase === 'test_complete' ||
    buildPhase === 'promoted' ||
    (pendingQuestions.length > 0);
  const needsDrawer = autoOpen || hasDraftRefine;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? autoOpen;

  return (
    <div className="flex flex-col gap-2">
      <HubTopBar
        buildPhase={buildPhase}
        completeness={completeness}
        isRunning={isRunning}
        buildActivity={buildActivity}
        onStartTest={onStartTest}
        onViewAgent={onViewAgent}
        expanded={expanded}
        onToggleExpand={() => setUserExpanded(!expanded)}
        showToggle={needsDrawer}
      />

      <AnimatePresence initial={false}>
        {expanded && needsDrawer && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="relative rounded-modal bg-card-bg border border-card-border shadow-elevation-2 p-4 overflow-hidden">
              {/* subtle ambient glow at top */}
              <div
                className="absolute inset-x-0 top-0 h-px pointer-events-none"
                style={{ background: 'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--primary) 30%, transparent) 50%, transparent 100%)' }}
              />
              {pendingQuestions.length > 0 && onAnswerBuildQuestion && (
                <div data-testid="build-inline-questions">
                  <GlyphQuestionPanel
                    questions={pendingQuestions}
                    onAnswer={onAnswerBuildQuestion}
                  />
                  {onSubmitAllAnswers && (
                    <button
                      type="button"
                      onClick={onSubmitAllAnswers}
                      className="mt-2 self-end px-4 py-2 rounded-modal bg-primary/15 border border-primary/30 hover:bg-primary/25 typo-body font-semibold text-foreground shadow-elevation-2 cursor-pointer"
                    >
                      {t.templates.chronology.hub_submit_answer}
                    </button>
                  )}
                </div>
              )}

              {buildPhase === 'draft_ready' && pendingQuestions.length === 0 && onRefine && (
                <DraftReadyRefinePanel
                  onRefine={onRefine}
                  onStartTest={onStartTest}
                  onDeleteDraft={onDeleteDraft}
                />
              )}

              {buildPhase === 'testing' && pendingQuestions.length === 0 && (
                <TestRunningIndicator testOutputLines={testOutputLines} />
              )}

              {buildPhase === 'test_complete' && pendingQuestions.length === 0 && (
                <TestResultsPanel
                  passed={testPassed}
                  outputLines={testOutputLines}
                  error={testError}
                  onApprove={onApproveTest}
                  onApproveAnyway={onApproveTestAnyway}
                  onReject={onRejectTest}
                  onRefine={onRefine}
                  onDeleteDraft={onDeleteDraft}
                  toolResults={toolTestResults}
                  summary={testSummary}
                />
              )}

              {buildPhase === 'promoted' && pendingQuestions.length === 0 && (
                <PromotionSuccessIndicator onViewAgent={onViewAgent} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const ChronologyCommandHub = memo(ChronologyCommandHubImpl);
