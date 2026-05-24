/** GlyphFullLayout — flagship build surface. Three phases share one canvas:
 *  1) Compose — form only, glyph hidden.
 *  2) Building — glyph dimmed, 60s orbital progress, form hidden.
 *  3) Refine — glyph lit, pending petals pulse, click → answer card
 *     overlays the sigil with no scrim and adopts the dimension's colour.
 *  Test/promote phases keep the lit glyph with status actions in the core. */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { BaseModal } from "@/lib/ui/BaseModal";
// Reuse the legacy 8-dim Matrix view's test-report modal — the rich
// split-pane viewer with structured ToolTestResult cards on the left
// and parsed LLM summary sections on the right (with credential-add
// flow integration). The Glyph variant gets parity automatically; no
// reason to maintain a parallel report surface.
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import type { GlyphDimension } from "@/features/shared/glyph";
import { useAgentStore } from "@/stores/agentStore";
import { CapabilityAddModal } from "@/features/agents/components/newPersona/capabilityView";
import { CommandPanel } from "./commandPanel";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphRowStrip } from "./GlyphRowStrip";
import { GlyphAnswerCard } from "./GlyphAnswerCard";
import { GlyphEditFace } from "./GlyphEditFace";
import { GlyphDimensionSummaryCard } from "./GlyphDimensionSummaryCard";
import { GlyphSigilFace } from "./GlyphSigilFace";
import { useGlyphLayoutState } from "./useGlyphLayoutState";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";
import { DebtText } from '@/i18n/DebtText';


export type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const SIZE = 640;

export function GlyphFullLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, completeness, cellStates,
    pendingQuestions, onAnswer, agentName, onAgentNameChange,
    hasDesignResult, glyphRows,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, toolTestResults, testSummary, cliOutputLines,
    onQuickConfigChange,
    initialNotificationChannels,
  } = props;

  const [face, setFace] = useState<"glyph" | "edit">("glyph");
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refining, setRefining] = useState(false);
  // A-grade Phase 5b — when the user clicks "Split via Refine" on a
  // capability card, we pre-populate the Refine composer with a
  // structured prompt asking the LLM to divide that capability. The
  // text is consumed by GlyphRefineComposer's `initialText` prop and
  // cleared after the composer mounts (or is cancelled).
  const [refinePrefill, setRefinePrefill] = useState<string | null>(null);
  const requestSplit = (_title: string, prompt: string) => {
    setRefinePrefill(prompt);
    setRefining(true);
  };
  const [showSimulate, setShowSimulate] = useState(false);
  const [showReport, setShowReport] = useState(false);
  // The intent composer is now a click-to-summon overlay. The center of
  // the sigil acts as the affordance during the pre-build state; users
  // who want to retry after a failed/cancelled build can re-open it the
  // same way.
  const [composerOpen, setComposerOpen] = useState(false);

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);

  // "Compose" = no active build session yet. The authoritative signal
  // is `buildSessionId === null` — buildPhase alone is unreliable
  // because the Zustand slice can leave it on "initializing" when no
  // session exists (default value, or stale state after a session was
  // removed). Using buildSessionId means: any active or pending session
  // → not compose; no session → compose, regardless of phase. Also
  // guards against `hasDesignResult` true on a hydrated promoted
  // persona — that's not a fresh-build state either.
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const isRefining = isBuilding && hasPending;
  const isBuildingOnly = isBuilding && !hasPending;

  // Auto-close the overlay once a session actually starts. handleLaunch
  // (the underlying onLaunch from UnifiedBuildEntry) is async — the
  // overlay should hide as soon as the phase transitions out of compose
  // so the glyph's loading sequence is visible immediately.
  useEffect(() => {
    if (!isCompose && composerOpen) setComposerOpen(false);
  }, [isCompose, composerOpen]);

  // Submit handler that wraps the parent's onLaunch and closes the
  // overlay optimistically — the parent will trigger the phase change
  // shortly after but we don't want a frame where both the form and
  // the loading sigil are visible.
  const handleLaunchAndClose = useCallback(() => {
    setComposerOpen(false);
    onLaunch();
  }, [onLaunch]);
  const handleComposeStart = useCallback(() => {
    setComposerOpen(true);
  }, []);
  const handleComposerClose = useCallback(() => {
    setComposerOpen(false);
  }, []);
  // Escape-to-dismiss the overlay (keyboard parity with click-outside).
  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setComposerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composerOpen]);

  useEffect(() => {
    if (activeRowIndex >= glyphRows.length) setActiveRowIndex(0);
  }, [glyphRows.length, activeRowIndex]);

  // 2026-05-05 — reset all per-draft local UI state when the active build
  // session changes. Without this, switching drafts (or creating a new one)
  // left the previous draft's `activeDim` set, so the overlay rendered
  // GlyphDimensionSummaryCard with no question — appearing as a "blank
  // questionnaire window". The store-mirrored scalars (pendingQuestions,
  // clarifyingQuestionV3, etc.) are correctly empty for the new session;
  // it's only the component-local pickers that needed scoping to sessionId.
  useEffect(() => {
    setActiveDim(null);
    setHoveredDim(null);
    setActiveRowIndex(0);
    setHoveredRowIndex(null);
    setFace("glyph");
    setRefining(false);
    setRefinePrefill(null);
    setShowSimulate(false);
    setShowReport(false);
  }, [buildSessionId]);

  const activeRow = glyphRows[activeRowIndex] ?? null;

  const { petalStates, activeQuestion, activeDimSummary } = useGlyphLayoutState({
    pendingQuestions, cellStates, activeRow, activeDim, setActiveDim,
  });

  // Enter submits, Shift+Enter inserts a newline — mirrors standard chat-input
  // conventions so users don't have to hunt for a keyboard shortcut.
  const handleLaunchKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) onLaunch();
    }
  }, [launchDisabled, onLaunch]);

  const completenessPct = Math.round(completeness);
  const closeActiveDim = () => setActiveDim(null);
  const onClickDim = (d: GlyphDimension) => setActiveDim((prev) => (prev === d ? null : d));

  // 2026-05-05 — phase 2 reactivity. The two card variants now render at
  // different positions:
  //   • GlyphAnswerCard (active question) stays as a centered overlay
  //     INSIDE the sigil canvas — answering still happens at the petal.
  //   • GlyphDimensionSummaryCard (populated dim, no pending question)
  //     pops out as a top-center page-level affordance so the glyph
  //     stays fully visible while the user reads the summary, and the
  //     summary is reachable from anywhere on the canvas.
  const overlay = activeDim && activeQuestion
    ? <GlyphAnswerCard question={activeQuestion} onAnswer={onAnswer} onClose={closeActiveDim} />
    : null;
  const topCenterSummary = activeDim && !activeQuestion ? activeDim : null;

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1 relative" data-testid="build-layout-glyph-full">
      {/* Top-center dimension summary popup. Triggered by clicking a
          populated petal — surfaces the dimension's resolved data
          (Memory contents, Trigger schedule, etc.) above the sigil so
          the glyph stays fully visible while the user reads. The
          GlyphAnswerCard for active questions still renders inside the
          sigil canvas via the `overlay` prop below. */}
      <AnimatePresence>
        {topCenterSummary && (
          <motion.div
            key={`top-summary-${topCenterSummary}`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute left-1/2 -translate-x-1/2 top-3 z-30 w-[min(440px,90vw)]"
            data-testid="glyph-dim-summary-popup"
          >
            <GlyphDimensionSummaryCard
              activeDim={topCenterSummary}
              summary={activeDimSummary}
              isPreBuild={isCompose}
              onClose={closeActiveDim}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Wizard surface — fixed 900px min-width so the layout stays
          breathable on narrower viewports + a subtle grid background
          gives the canvas its own identity (was blending into the page
          background before). The outer flex centers it horizontally;
          the inner column stacks topbar, sigil, answer card, etc. */}
      <div className="flex flex-col items-center pb-14 pt-4">
        <div
          className="min-w-[640px] md:min-w-[800px] lg:min-w-[920px] w-full max-w-[1400px] flex flex-col items-center gap-5 rounded-modal"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), " +
              "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
        <GlyphTopBar
          agentName={agentName}
          onAgentNameChange={onAgentNameChange}
          isPreBuild={isCompose}
          isBuilding={isBuilding}
          buildPhase={buildPhase}
          face={face}
          onFaceChange={setFace}
          editLocked={hasPending}
        />

        {/* Active capability title — kept top-centred above the sigil.
            The strip itself was moved to a vertical column on the left
            of the sigil (below) per user feedback; only the title
            renders in this band so the canvas can stay symmetrical. */}
        {face === "glyph" && !isCompose && glyphRows.length > 0 && (
          <div className="min-h-[1.75rem] flex items-center justify-center">
            <span
              className="typo-heading-sm font-semibold text-center text-foreground"
              key={
                hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
                  ? `${glyphRows[hoveredRowIndex]?.id}-preview`
                  : `${glyphRows[activeRowIndex]?.id}-active`
              }
            >
              {(hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
                ? glyphRows[hoveredRowIndex]?.title
                : glyphRows[activeRowIndex]?.title) ?? ""}
            </span>
          </div>
        )}

        {face === "edit" ? (
          <GlyphEditFace onAddCapability={() => setShowAdd(true)} />
        ) : (
          <div className="flex items-start gap-4">
            {/* Vertical strip — anchored to the left of the sigil. Hides
                during pre-build (no capabilities yet) and on the edit
                face (separate UI). */}
            {!isCompose && glyphRows.length > 0 && (
              <div className="pt-6 shrink-0">
                <GlyphRowStrip
                  rows={glyphRows}
                  activeIndex={activeRowIndex}
                  hoveredIndex={hoveredRowIndex}
                  onSelect={setActiveRowIndex}
                  onHover={setHoveredRowIndex}
                  onAdd={() => setShowAdd(true)}
                  canAdd={!isBuilding}
                  vertical
                />
              </div>
            )}
            <GlyphSigilFace
              size={SIZE}
              petalStates={petalStates}
              hoveredDim={hoveredDim}
              activeDim={activeDim}
              onHoverDim={setHoveredDim}
              onClickDim={onClickDim}
              isCompose={isCompose}
              isBuilding={isBuilding}
              isBuildingOnly={isBuildingOnly}
              isRefining={isRefining}
              buildPhase={buildPhase}
            hasDesignResult={hasDesignResult}
            cellStates={cellStates}
            pendingQuestions={pendingQuestions}
            cliOutputLines={cliOutputLines}
            refining={refining}
            setRefining={setRefining}
            completenessPct={completenessPct}
            testOutputLines={testOutputLines}
            testPassed={testPassed}
            testError={testError}
            onStartTest={onStartTest}
            onPromote={onPromote}
            onPromoteForce={onPromoteForce}
            onRejectTest={onRejectTest}
            onRefine={onRefine}
            onViewAgent={onViewAgent}
            onShowSimulate={() => setShowSimulate(true)}
            buildSessionId={buildSessionId}
            overlay={overlay}
            onComposeStart={isCompose ? handleComposeStart : undefined}
            onShowReport={() => setShowReport(true)}
            onRequestSplit={requestSplit}
            refinePrefill={refinePrefill}
            onClearRefinePrefill={() => setRefinePrefill(null)}
          />
          </div>
        )}

        {buildError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
            <AlertCircle className="w-4 h-4" />
            <span>{buildError}</span>
          </div>
        )}
        </div>
      </div>

      {/* Intent composer overlay — summoned by clicking the centre of the
          sigil during pre-build. Scrim dismisses on click-outside; ESC
          dismisses via the listener installed above; submit closes the
          overlay before the build phase has visibly transitioned so the
          loading sigil is the next thing the user sees. */}
      <AnimatePresence>
        {composerOpen && (
          <BaseModal
            isOpen
            onClose={handleComposerClose}
            titleId="glyph-composer-title"
            maxWidthClass="max-w-none"
            panelClassName="relative z-10 w-full flex justify-center bg-transparent shadow-none overflow-visible"
            containerClassName="fixed inset-0 z-40 flex items-center justify-center px-4"
            staggerChildren={false}
          >
              <h2 id="glyph-composer-title" className="sr-only"><DebtText k="auto_describe_your_agent_d2e2c1aa" /></h2>
              <CommandPanel
                intentText={intentText}
                onIntentChange={onIntentChange}
                onLaunch={handleLaunchAndClose}
                launchDisabled={launchDisabled}
                onKeyDown={handleLaunchKey}
                onQuickConfigChange={onQuickConfigChange}
                isBuilding={isBuilding}
                initialNotificationChannels={initialNotificationChannels}
              />
          </BaseModal>
        )}
      </AnimatePresence>

      <CapabilityAddModal open={showAdd} onClose={() => setShowAdd(false)} />
      <BuildSimulatePanel
        isOpen={showSimulate}
        onClose={() => setShowSimulate(false)}
        sessionId={buildSessionId}
        draft={buildDraft}
      />
      {showReport && (
        <TestReportModal
          results={toolTestResults ?? []}
          summary={testSummary ?? null}
          onClose={() => setShowReport(false)}
          // When the user quick-adds a missing credential from inside the
          // report, refresh personas so the next test run + the linked
          // credential reflect immediately. The vault store already
          // refreshes itself inside ConnectorHandshakeCard's handleSave;
          // this closes the loop on the persona side.
          onCredentialAdded={() => {
            void useAgentStore.getState().fetchPersonas();
          }}
        />
      )}
    </div>
  );
}
