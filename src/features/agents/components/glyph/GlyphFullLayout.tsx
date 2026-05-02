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
import type { GlyphDimension } from "@/features/shared/glyph";
import { useAgentStore } from "@/stores/agentStore";
import { CapabilityAddModal } from "@/features/agents/components/newPersona/capabilityView";
import { CommandPanel } from "./commandPanel";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphRowSection } from "./GlyphRowSection";
import { GlyphAnswerCard } from "./GlyphAnswerCard";
import { GlyphEditFace } from "./GlyphEditFace";
import { GlyphDimensionSummaryCard } from "./GlyphDimensionSummaryCard";
import { GlyphSigilFace } from "./GlyphSigilFace";
import { useGlyphLayoutState } from "./useGlyphLayoutState";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

export type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const SIZE = 640;

export function GlyphFullLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, completeness, cellStates,
    pendingQuestions, onAnswer, agentName, onAgentNameChange,
    hasDesignResult, glyphRows,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, cliOutputLines,
    onQuickConfigChange,
  } = props;

  const [face, setFace] = useState<"glyph" | "edit">("glyph");
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [refining, setRefining] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
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
  // (the underlying onLaunch from UnifiedMatrixEntry) is async — the
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

  const overlay = activeDim
    ? activeQuestion
      ? <GlyphAnswerCard question={activeQuestion} onAnswer={onAnswer} onClose={closeActiveDim} />
      : <GlyphDimensionSummaryCard
          activeDim={activeDim}
          summary={activeDimSummary}
          isPreBuild={isCompose}
          onClose={closeActiveDim}
        />
    : null;

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-glyph-full">
      <div className="flex flex-col items-center gap-5 pb-14 pt-4">
        <GlyphTopBar
          agentName={agentName}
          onAgentNameChange={onAgentNameChange}
          isPreBuild={isCompose}
          isBuilding={isBuilding}
          buildPhase={buildPhase}
          face={face}
          onFaceChange={setFace}
        />

        {/* Row strip is meaningful only once we have capabilities — hide
            during pre-build (no UCs to show yet). */}
        {face === "glyph" && !isCompose && (
          <GlyphRowSection
            rows={glyphRows}
            activeIndex={activeRowIndex}
            hoveredIndex={hoveredRowIndex}
            onSelect={setActiveRowIndex}
            onHover={setHoveredRowIndex}
            onAdd={() => setShowAdd(true)}
            canAdd={!isBuilding}
          />
        )}

        {face === "edit" ? (
          <GlyphEditFace onAddCapability={() => setShowAdd(true)} />
        ) : (
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
          />
        )}

        {buildError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
            <AlertCircle className="w-4 h-4" />
            <span>{buildError}</span>
          </div>
        )}
      </div>

      {/* Intent composer overlay — summoned by clicking the centre of the
          sigil during pre-build. Scrim dismisses on click-outside; ESC
          dismisses via the listener installed above; submit closes the
          overlay before the build phase has visibly transitioned so the
          loading sigil is the next thing the user sees. */}
      <AnimatePresence>
        {composerOpen && (
          <motion.div
            key="composer-overlay"
            className="fixed inset-0 z-40 flex items-center justify-center px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              role="presentation"
              onClick={handleComposerClose}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              data-testid="composer-overlay-scrim"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Describe your agent"
              className="relative z-10 w-full flex justify-center"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <CommandPanel
                intentText={intentText}
                onIntentChange={onIntentChange}
                onLaunch={handleLaunchAndClose}
                launchDisabled={launchDisabled}
                onKeyDown={handleLaunchKey}
                onQuickConfigChange={onQuickConfigChange}
                isBuilding={isBuilding}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CapabilityAddModal open={showAdd} onClose={() => setShowAdd(false)} />
      <BuildSimulatePanel
        isOpen={showSimulate}
        onClose={() => setShowSimulate(false)}
        sessionId={buildSessionId}
        draft={buildDraft}
      />
    </div>
  );
}
