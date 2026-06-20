/**
 * Orchestration hook bridging useBuildSession to matrix UI consumption.
 *
 * This hook is the primary integration point between Phase 1's backend
 * streaming infrastructure (useBuildSession + matrixBuildSlice) and the
 * matrix creation UI. It reads build state from the Zustand store, computes
 * derived values (completeness, isBuilding, isIdle), and wraps session
 * control functions for component consumption.
 *
 * Replaces useMatrixOrchestration for the unified matrix build surface.
 */
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBuildSession } from "@/hooks/build/useBuildSession";
import { useAgentStore } from "@/stores/agentStore";
import { ALL_CELL_KEYS } from "@/lib/constants/dimensionMapping";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseBuildOptions {
  personaId: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBuild({ personaId }: UseBuildOptions) {
  const session = useBuildSession({ personaId });

  // -- Read build state from Zustand selectors ----------------------------

  const {
    buildPhase,
    cellStates,
    cellData,
    pendingQuestions,
    outputLines,
    buildError,
    buildTestPassed,
    buildTestOutputLines,
    buildTestError,
    buildActivity,
    pendingAnswerCount,
    buildSessionId,
  } = useAgentStore(useShallow((s) => ({
    buildPhase: s.buildPhase,
    cellStates: s.buildCellStates,
    cellData: s.buildCellData,
    pendingQuestions: s.buildPendingQuestions,
    outputLines: s.buildOutputLines,
    buildError: s.buildError,
    buildTestPassed: s.buildTestPassed,
    buildTestOutputLines: s.buildTestOutputLines,
    buildTestError: s.buildTestError,
    buildActivity: s.buildActivity,
    pendingAnswerCount: Object.keys(s.buildPendingAnswers).length,
    buildSessionId: s.buildSessionId,
  })));

  // -- Derived state ------------------------------------------------------

  /**
   * Completeness: percentage of ALL_CELL_KEYS that have reached "resolved" status.
   * 0 = nothing resolved, 100 = all 8 cells resolved.
   */
  const completeness = useMemo(() => {
    const resolved = ALL_CELL_KEYS.filter(
      (key) => cellStates[key] === "resolved",
    ).length;
    return Math.round((resolved / ALL_CELL_KEYS.length) * 100);
  }, [cellStates]);

  /** Whether the build is in an active processing state. */
  const isBuilding =
    buildPhase === "analyzing" || buildPhase === "resolving";

  /**
   * Initial idle state: phase is "initializing" and no session exists.
   * Uses getState() (not a selector) since this is a simple boolean derivation
   * that doesn't need per-render reactivity for buildSessionId changes.
   */
  const isIdle =
    buildPhase === "initializing" &&
    !buildSessionId;

  // -- Action wrappers ----------------------------------------------------

  const handleGenerate = useCallback(
    async (
      intent: string,
      overridePersonaId?: string,
      workflowJson?: string,
      parserResultJson?: string,
      mode?: 'interactive' | 'one_shot' | null,
      companionSessionId?: string | null,
      context?: string | null,
    ) => {
      await session.startSession(
        intent,
        overridePersonaId,
        workflowJson,
        parserResultJson,
        mode,
        companionSessionId,
        context,
      );
    },
    [session],
  );

  const handleAnswer = useCallback(
    async (
      cellKey: string,
      answer: string,
      reference?: import("@/lib/types/buildTypes").BuildReference | null,
      webhookSource?: import("@/lib/types/buildTypes").BuildWebhookSource | null,
    ) => {
      await session.answerQuestion(cellKey, answer, reference, webhookSource);
    },
    [session],
  );

  const handleSubmitAnswers = useCallback(async () => {
    await session.submitAllAnswers();
  }, [session]);

  const handleCancel = useCallback(async () => {
    await session.cancelSession();
  }, [session]);

  // -- Return -------------------------------------------------------------

  return {
    // State
    buildPhase,
    cellStates,
    cellData,
    pendingQuestions,
    completeness,
    outputLines,
    buildError,
    isBuilding,
    isIdle,
    // Test lifecycle state
    buildTestPassed,
    buildTestOutputLines,
    buildTestError,
    // Activity
    buildActivity,
    pendingAnswerCount,
    // Actions
    handleGenerate,
    handleAnswer,
    handleSubmitAnswers,
    handleCancel,
  };
}
