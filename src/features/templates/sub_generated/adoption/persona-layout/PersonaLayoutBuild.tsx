import { useCallback, useMemo, useState } from 'react';
import { Loader2, Play, Rocket, RefreshCw, X, ScrollText, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension, GlyphRow } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import type {
  BuildPhase,
  BuildQuestion,
  CellBuildStatus,
  ToolTestResult,
} from '@/lib/types/buildTypes';
import { GlyphAnswerCard } from '@/features/agents/sub_glyph/GlyphAnswerCard';
import { TestReportModal } from '../chronology/TestReportModal';
import { useUseCaseChronology } from '../chronology/useUseCaseChronology';
import {
  type DisplayUseCase,
} from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface PersonaLayoutBuildProps {
  buildPhase: BuildPhase | null;
  completeness: number;
  isBuilding: boolean;
  buildActivity: string | null;
  cellStates: Record<string, CellBuildStatus>;
  pendingQuestions: BuildQuestion[] | null;
  onAnswerBuildQuestion?: (cellKey: string, answer: string) => void;
  onStartTest: () => void | Promise<void>;
  onApproveTest: () => void;
  onApproveTestAnyway: () => void;
  onRejectTest?: () => void;
  onDeleteDraft?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onViewAgent: () => void;
  templateName: string;
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  toolTestResults?: ToolTestResult[];
  testSummary?: string | null;
}

// Map cellState keys (the build-engine vocabulary) onto persona-sigil
// dimensions. Mirrors `agents/sub_glyph/glyphLayoutHelpers.ts`
// CELL_KEY_TO_DIM but kept local so this surface doesn't reach into the
// scratch flow's helpers.
const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  'sample-output': 'task',
  'use-cases': 'task',
  connectors: 'connector',
  triggers: 'trigger',
  'human-review': 'review',
  messages: 'message',
  memory: 'memory',
  'error-handling': 'error',
  events: 'event',
};
const DIM_TO_CELL_KEY: Record<GlyphDimension, string> = Object.fromEntries(
  Object.entries(CELL_KEY_TO_DIM).map(([k, v]) => [v, k]),
) as Record<GlyphDimension, string>;

/**
 * Bridge a `GlyphRow` (the canonical build-time row shape from
 * useUseCaseChronology) onto the `DisplayUseCase` shape `PersonaLayout`
 * wants. The post-seed surface doesn't need `raw` for execution — the
 * persona isn't yet wired to a runnable backend — so we synthesize the
 * minimum shape.
 */
function glyphRowToDisplay(row: GlyphRow): DisplayUseCase {
  const dimensions: GlyphDimension[] = GLYPH_DIMENSIONS.filter(
    (d) => row.presence[d] !== 'none',
  );
  const connector = row.connectors[0];
  const trigger = row.triggers[0];
  return {
    id: row.id,
    title: row.title,
    description: row.summary ?? row.description ?? '',
    category: undefined,
    mode: 'e2e',
    health: row.enabled ? 'active' : 'disabled',
    hasModelOverride: !!row.recommendedModel,
    notificationChannels: row.events.map((e) => e.event_type),
    triggerLabel: trigger?.description ?? (trigger?.trigger_type ?? 'Manual'),
    connector: connector?.label ?? connector?.name ?? '',
    connectorKey: connector?.name ?? null,
    dimensions,
    // `raw` is required by the type but unused post-seed (the row
    // doesn't drive execution from this surface). Cast through unknown
    // so consumers that don't introspect raw stay happy.
    raw: { id: row.id } as DisplayUseCase['raw'],
  };
}

/**
 * Build-phase wrapper around `PersonaLayout`. Renders inside the adoption
 * modal after the user clicks Continue and a build session is created.
 * Shows the persona sigil with petal states driven by the build engine's
 * cellStates, lifecycle actions in `belowHeroSlot`, and a phase status
 * card in the sigil center.
 *
 * Mid-build Q&A and the rich test-results UI from the legacy command hub
 * are not yet ported — they'll land in a follow-up. The current cut
 * surfaces the most-load-bearing controls (Start Test, Promote, Refine,
 * Reject) so the user can drive the persona through to promotion without
 * leaving the Persona Layout shell.
 */
export function PersonaLayoutBuild({
  buildPhase,
  isBuilding,
  buildActivity,
  cellStates,
  pendingQuestions,
  onStartTest,
  onApproveTest,
  onApproveTestAnyway,
  onRejectTest,
  onDeleteDraft,
  onRefine,
  onAnswerBuildQuestion,
  onViewAgent,
  templateName,
  testPassed,
  testError,
  toolTestResults,
  testSummary,
}: PersonaLayoutBuildProps) {
  const { t } = useTranslation();
  const rows = useUseCaseChronology();
  const buildDraft = useAgentStore((s) => s.buildDraft);

  // Which pending-question petal the user is currently focused on.
  // When null, the wide overlay is empty (no card visible). Clicking
  // any pending petal sets this to that dim; submitting/closing the
  // card clears it back to null.
  const [activeQuestionDim, setActiveQuestionDim] = useState<GlyphDimension | null>(null);

  // Inline refine composer state — toggled by clicking "Refine" in the
  // footer. Captures the user's freeform feedback before sending to
  // onRefine.
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');

  // Rich test-results modal — shown when the user clicks "View Logs"
  // after a test_complete phase.
  const [reportOpen, setReportOpen] = useState(false);

  const items = useMemo<DisplayUseCase[]>(
    () => rows.map(glyphRowToDisplay),
    [rows],
  );

  const personaName = useMemo(() => {
    const draftName = (buildDraft as Record<string, unknown> | null)?.name;
    return typeof draftName === 'string' && draftName.trim() ? draftName : templateName;
  }, [buildDraft, templateName]);

  // Look up pending question by dim — used by petal click + auto-focus.
  const pendingQuestionByDim = useMemo(() => {
    const out = new Map<GlyphDimension, BuildQuestion>();
    if (pendingQuestions) {
      for (const q of pendingQuestions) {
        const dim = CELL_KEY_TO_DIM[q.cellKey];
        if (dim && !out.has(dim)) out.set(dim, q);
      }
    }
    return out;
  }, [pendingQuestions]);

  // Derive petal states from cellStates. Pending build questions surface
  // as `pending` on the matching petal; building-phase cells render as
  // `filling`; resolved cells stay `resolved`.
  const petalStates = useMemo<Record<GlyphDimension, PetalState>>(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      if (pendingQuestionByDim.has(dim)) {
        out[dim] = 'pending';
        continue;
      }
      const cellStatus = cellStates[DIM_TO_CELL_KEY[dim]];
      if (cellStatus === 'error') {
        out[dim] = 'error';
      } else if (cellStatus === 'resolved' || cellStatus === 'updated' || cellStatus === 'highlighted') {
        out[dim] = 'resolved';
      } else if (cellStatus === 'filling' || cellStatus === 'pending') {
        out[dim] = 'filling';
      } else {
        out[dim] = 'idle';
      }
    }
    return out;
  }, [cellStates, pendingQuestionByDim]);

  // Petal click — only meaningful when the petal carries a pending
  // question. Opens the answer card for that dim.
  const handlePetalClick = useCallback((dim: GlyphDimension) => {
    if (pendingQuestionByDim.has(dim)) {
      setActiveQuestionDim((prev) => (prev === dim ? null : dim));
    }
  }, [pendingQuestionByDim]);

  // When the user submits an answer to a pending question, advance to
  // the next pending one if there is one (so the user doesn't lose
  // momentum); otherwise close the overlay.
  const handleAnswerAndAdvance = useCallback((cellKey: string, answer: string) => {
    if (!onAnswerBuildQuestion) return;
    onAnswerBuildQuestion(cellKey, answer);
    // Find the next pending question after this one.
    const others = (pendingQuestions ?? []).filter((q) => q.cellKey !== cellKey);
    const next = others[0];
    if (next) {
      const nextDim = CELL_KEY_TO_DIM[next.cellKey];
      setActiveQuestionDim(nextDim ?? null);
    } else {
      setActiveQuestionDim(null);
    }
  }, [onAnswerBuildQuestion, pendingQuestions]);

  // Center sigil overlay — phase-aware status card. Shows progress,
  // current activity, or terminal state (pass/fail).
  const centerOverlay = useMemo(() => {
    if (!buildPhase) return <span aria-hidden />;
    if (buildPhase === 'promoted') {
      return (
        <div className="pointer-events-auto flex flex-col items-center gap-2 px-5 py-4 rounded-modal bg-status-success/10 border border-status-success/40">
          <CheckCircle2 className="w-8 h-8 text-status-success" />
          <span className="typo-label uppercase tracking-[0.2em] text-status-success">
            {t.templates.matrix_variants.agent_promoted}
          </span>
        </div>
      );
    }
    if (buildPhase === 'test_complete') {
      return (
        <div className="pointer-events-auto flex flex-col items-center gap-2 px-5 py-4 rounded-modal bg-background/95 backdrop-blur-md border border-card-border">
          {testPassed ? (
            <>
              <CheckCircle2 className="w-7 h-7 text-status-success" />
              <span className="typo-label uppercase tracking-[0.2em] text-status-success">
                {t.templates.chronology.hub_phase_test_complete}
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-7 h-7 text-status-warning" />
              <span className="typo-label uppercase tracking-[0.2em] text-status-warning">
                {t.templates.chronology.hub_phase_test_complete}
              </span>
              {testError && (
                <p className="typo-caption text-foreground max-w-[220px] line-clamp-2 text-center">
                  {testError}
                </p>
              )}
            </>
          )}
        </div>
      );
    }
    if (isBuilding || buildPhase === 'testing') {
      return (
        <div className="pointer-events-auto flex flex-col items-center gap-2 px-5 py-4 rounded-modal bg-background/90 backdrop-blur-md border border-primary/30">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
          <span className="typo-label uppercase tracking-[0.2em] text-primary">
            {buildPhase === 'testing'
              ? t.templates.chronology.hub_phase_testing
              : t.templates.chronology.hub_phase_analyzing}
          </span>
          {buildActivity && (
            <span className="typo-caption text-foreground max-w-[260px] text-center line-clamp-2">
              {buildActivity}
            </span>
          )}
        </div>
      );
    }
    if (buildPhase === 'draft_ready') {
      return (
        <div className="pointer-events-auto flex flex-col items-center gap-2 px-5 py-4 rounded-modal bg-background/90 backdrop-blur-md border border-status-info/35">
          <span className="typo-label uppercase tracking-[0.2em] text-status-info">
            {t.templates.chronology.hub_phase_draft_ready}
          </span>
          <span className="typo-caption text-foreground max-w-[260px] text-center">
            {t.templates.adopt_modal.persona_layout_build_draft_ready_hint}
          </span>
        </div>
      );
    }
    return <span aria-hidden />;
  }, [
    buildPhase,
    isBuilding,
    buildActivity,
    testPassed,
    testError,
    t,
  ]);

  // Below-hero — phase-appropriate actions.
  const belowHero = useMemo(() => {
    const phaseTesting = buildPhase === 'testing';
    const phaseDraftReady = buildPhase === 'draft_ready';
    const phaseTestComplete = buildPhase === 'test_complete';
    const phasePromoted = buildPhase === 'promoted';
    const phaseFailed = buildPhase === 'failed' || buildPhase === 'cancelled';

    return (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {phaseDraftReady && (
          <button
            type="button"
            onClick={() => void onStartTest()}
            disabled={phaseTesting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-primary/40 bg-primary/25 hover:bg-primary/40 text-foreground typo-body cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.start_test}
          </button>
        )}

        {phaseTestComplete && (
          <>
            <button
              type="button"
              onClick={testPassed ? onApproveTest : onApproveTestAnyway}
              data-testid="adopt-approve-and-promote"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5" />
              {testPassed ? t.templates.matrix_variants.approve_and_promote : t.templates.matrix_variants.approve_anyway}
            </button>
            {(toolTestResults?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-body text-foreground/85 cursor-pointer"
              >
                <ScrollText className="w-3.5 h-3.5" />
                {t.templates.adopt_modal.persona_layout_build_view_logs}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onStartTest()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-body text-foreground/85 cursor-pointer"
              title={t.templates.n8n.retest}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t.templates.n8n.retest}
            </button>
            {onRejectTest && (
              <button
                type="button"
                onClick={onRejectTest}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-foreground hover:text-foreground typo-caption cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                {t.common.reject}
              </button>
            )}
          </>
        )}

        {phasePromoted && (
          <button
            type="button"
            onClick={onViewAgent}
            data-testid="adopt-view-agent"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-status-success/25 hover:bg-status-success/40 border border-status-success/40 text-foreground typo-body cursor-pointer"
          >
            <ScrollText className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.view_agent_btn}
          </button>
        )}

        {(phaseFailed || (phaseTestComplete && !testPassed)) && onDeleteDraft && (
          <button
            type="button"
            onClick={onDeleteDraft}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-status-error/85 hover:text-status-error typo-caption cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.delete_draft}
          </button>
        )}

        {onRefine && (phaseDraftReady || phaseTestComplete) && (
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full typo-caption cursor-pointer transition-colors ${
              refineOpen
                ? 'bg-primary/15 border border-primary/35 text-foreground'
                : 'text-foreground hover:text-foreground'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t.common.refine}
          </button>
        )}
      </div>
    );
  }, [
    buildPhase,
    testPassed,
    onStartTest,
    onApproveTest,
    onApproveTestAnyway,
    onRejectTest,
    onDeleteDraft,
    onRefine,
    onViewAgent,
    refineOpen,
    toolTestResults,
    t,
  ]);

  // Wide overlay — priorities (only one shows at a time):
  //   1. refine composer (user toggled "Refine")
  //   2. mid-build answer card (a pending question's petal is active)
  //   3. nothing
  const activeQuestion =
    activeQuestionDim != null
      ? pendingQuestionByDim.get(activeQuestionDim) ?? null
      : null;
  const wideOverlay = refineOpen ? (
    <RefineComposer
      initialText={refineText}
      onCancel={() => {
        setRefineOpen(false);
        setRefineText('');
      }}
      onSend={(text) => {
        setRefineOpen(false);
        setRefineText('');
        void onRefine?.(text);
      }}
    />
  ) : activeQuestion ? (
    <GlyphAnswerCard
      question={activeQuestion}
      onAnswer={handleAnswerAndAdvance}
      onClose={() => setActiveQuestionDim(null)}
    />
  ) : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      <PersonaLayout
        mode="adoption"
        personaName={personaName}
        items={items}
        onRowOpen={() => {
          // Row editing during build is a follow-up — clicks are no-op here.
        }}
        onRowToggle={() => {
          // Same.
        }}
        onHeroPetalClick={handlePetalClick}
        heroActiveDim={activeQuestionDim}
        heroPetalStatesOverride={petalStates}
        heroCenterOverlay={centerOverlay}
        heroWideOverlay={wideOverlay}
        belowHeroSlot={belowHero}
        sigilDimmed={isBuilding || buildPhase === 'testing'}
        sigilShowOrbit={isBuilding || buildPhase === 'testing'}
      />

      {reportOpen && (toolTestResults?.length ?? 0) > 0 && (
        <TestReportModal
          results={toolTestResults ?? []}
          summary={testSummary}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Inline refine composer ────────────────────────────────────────────

interface RefineComposerProps {
  initialText: string;
  onCancel: () => void;
  onSend: (text: string) => void;
}

/** Inline textarea + send for the post-draft refine flow. Wrapped in a
 *  small card so it sits cleanly inside the wide-overlay container. */
function RefineComposer({ initialText, onCancel, onSend }: RefineComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
  };

  return (
    <div
      className="pointer-events-auto relative rounded-modal bg-background/95 backdrop-blur-md shadow-elevation-3 border border-primary/30 flex flex-col"
      style={{
        boxShadow: '0 0 24px rgba(96,165,250,0.25), 0 8px 32px rgba(0,0,0,0.35)',
        maxWidth: 'min(720px, 92vw)',
      }}
    >
      <div className="absolute top-0 left-0 w-full h-1 rounded-t-modal bg-gradient-to-r from-primary to-transparent" />
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <RefreshCw className="w-4 h-4 text-primary" />
        <span className="typo-label uppercase tracking-[0.2em] text-primary font-bold">
          {t.common.refine}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors cursor-pointer"
          aria-label={t.common.close}
          title={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 pb-3">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t.templates.adopt_modal.persona_layout_build_refine_placeholder}
          rows={4}
          className="w-full px-3 py-2 rounded-modal bg-primary/5 border border-primary/20 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40 resize-none"
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-foreground/[0.02] rounded-b-modal">
        <button
          type="button"
          onClick={onCancel}
          className="typo-caption px-3 py-1.5 rounded-full text-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          {t.templates.adopt_modal.persona_layout_build_refine_send}
        </button>
      </div>
    </div>
  );
}
