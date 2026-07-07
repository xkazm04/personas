/** GlyphStageSurface — the shared post-compose build/refine/test stage.
 *
 *  Extracted (2026-07-07) from GlyphPrototypeLayout's non-compose branch so
 *  every compose-surface prototype (Dialogue, Constellation, …) can diverge on
 *  the *compose* experience — the differentiator — while delegating build →
 *  refine → test → promote to one identical, already-proven surface.
 *
 *  This renders the sigil face, the vertical capability strip, the active
 *  capability title band, the refine answer-card overlay, and the build/test
 *  modals. It owns only the local UI state those phases need. It is NEVER the
 *  compose surface — callers render it only when `!isCompose`.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { CapabilityAddModal } from "@/features/agents/sub_new_persona/capabilityView";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GlyphRowStrip } from "./GlyphRowStrip";
import { GlyphSigilFace } from "./GlyphSigilFace";
import { GlyphAnswerCard } from "./GlyphAnswerCard";
import { useGlyphLayoutState } from "./useGlyphLayoutState";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const SIZE = 640;

export function GlyphStageSurface(props: GlyphFullLayoutProps) {
  const {
    onIntentChange, onLaunch,
    isBuilding, buildPhase, completeness, cellStates,
    pendingQuestions, onAnswer,
    hasDesignResult, glyphRows,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, toolTestResults, testSummary, cliOutputLines,
  } = props;
  // onIntentChange / onLaunch are part of the shared prop contract but the
  // build/test stage never re-launches — reference them so the shape stays
  // identical to the compose surfaces without an unused-var lint.
  void onIntentChange;
  void onLaunch;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const isRefining = isBuilding && hasPending;
  const isBuildingOnly = isBuilding && !hasPending;

  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [refining, setRefining] = useState(false);
  const [refinePrefill, setRefinePrefill] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const activeRow = glyphRows[activeRowIndex] ?? null;

  const requestSplit = useCallback((_title: string, prompt: string) => {
    setRefinePrefill(prompt);
    setRefining(true);
  }, []);

  const { petalStates, activeQuestion, activeDimSummary } = useGlyphLayoutState({
    pendingQuestions, cellStates, activeRow, activeDim, setActiveDim,
  });
  void activeDimSummary;

  // Session-change isolation guard — mirror the baseline so a new build
  // never inherits stale local state.
  useEffect(() => {
    setActiveDim(null);
    setHoveredDim(null);
    setActiveRowIndex(0);
    setHoveredRowIndex(null);
    setRefining(false);
    setRefinePrefill(null);
    setShowAdd(false);
    setShowSimulate(false);
    setShowReport(false);
  }, [buildSessionId]);

  const closeActiveDim = () => setActiveDim(null);
  const onClickDim = (d: GlyphDimension) =>
    setActiveDim((prev) => (prev === d ? null : d));

  const completenessPct = Math.round(completeness);
  const overlay = useMemo(
    () =>
      activeDim && activeQuestion ? (
        <GlyphAnswerCard question={activeQuestion} onAnswer={onAnswer} onClose={closeActiveDim} />
      ) : null,
    [activeDim, activeQuestion, onAnswer],
  );

  const activeTitle =
    (hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
      ? glyphRows[hoveredRowIndex]?.title
      : glyphRows[activeRowIndex]?.title) ?? "";

  return (
    <>
      {glyphRows.length > 0 && (
        <div className="min-h-[1.75rem] flex items-center justify-center">
          <span
            className="typo-heading-lg font-semibold text-center text-foreground"
            key={
              hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
                ? `${glyphRows[hoveredRowIndex]?.id}-preview`
                : `${glyphRows[activeRowIndex]?.id}-active`
            }
          >
            {activeTitle}
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        {glyphRows.length > 0 && (
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
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <GlyphSigilFace
            size={SIZE}
            petalStates={petalStates}
            hoveredDim={hoveredDim}
            activeDim={activeDim}
            onHoverDim={setHoveredDim}
            onClickDim={onClickDim}
            isCompose={false}
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
            onShowReport={() => setShowReport(true)}
            onRequestSplit={requestSplit}
            refinePrefill={refinePrefill}
            onClearRefinePrefill={() => setRefinePrefill(null)}
          />
        </div>
      </div>

      {buildError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
          <AlertCircle className="w-4 h-4" />
          <span>{buildError}</span>
        </div>
      )}

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
          onCredentialAdded={() => {
            void useAgentStore.getState().fetchPersonas();
          }}
        />
      )}
    </>
  );
}
