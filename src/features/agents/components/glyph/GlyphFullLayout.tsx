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

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);

  // "Compose" = the pre-launch state where the intent textarea is shown.
  // We must exclude every phase that represents an active build session,
  // not just the two `isBuilding` covers (analyzing|resolving). Without
  // the awaiting_input/initializing exclusions, a clarifying question
  // landing flips the layout back to the init form because isBuilding
  // toggles false while the user waits to answer. Failed/cancelled
  // intentionally fall through so users can retry from the same surface.
  const isCompose =
    !isBuilding
    && !hasDesignResult
    && buildPhase !== "awaiting_input"
    && buildPhase !== "initializing";
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const isRefining = isBuilding && hasPending;
  const isBuildingOnly = isBuilding && !hasPending;

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

        {/* Compose-only form. Mid-build follow-ups are answered through the
            glyph (petal click → overlay card), so the panel hides once the
            build is in flight. */}
        <AnimatePresence mode="wait">
          {isCompose && (
            <motion.div
              key="command-panel"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="w-full flex justify-center"
            >
              <CommandPanel
                intentText={intentText}
                onIntentChange={onIntentChange}
                onLaunch={onLaunch}
                launchDisabled={launchDisabled}
                onKeyDown={handleLaunchKey}
                onQuickConfigChange={onQuickConfigChange}
              />
            </motion.div>
          )}
        </AnimatePresence>

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
          />
        )}

        {buildError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
            <AlertCircle className="w-4 h-4" />
            <span>{buildError}</span>
          </div>
        )}
      </div>

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
