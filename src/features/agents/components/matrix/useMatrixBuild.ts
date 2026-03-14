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
import { useBuildSession } from "@/hooks/build/useBuildSession";
import { useAgentStore } from "@/stores/agentStore";
import { ALL_CELL_KEYS } from "@/lib/constants/dimensionMapping";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMatrixBuildOptions {
  personaId: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMatrixBuild({ personaId }: UseMatrixBuildOptions) {
  const session = useBuildSession({ personaId });

  // -- Read build state from Zustand selectors ----------------------------

  const buildPhase = useAgentStore((s) => s.buildPhase);
  const cellStates = useAgentStore((s) => s.buildCellStates);
  const pendingQuestions = useAgentStore((s) => s.buildPendingQuestions);
  const outputLines = useAgentStore((s) => s.buildOutputLines);
  const buildError = useAgentStore((s) => s.buildError);

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
    !useAgentStore.getState().buildSessionId;

  // -- Action wrappers ----------------------------------------------------

  const handleGenerate = useCallback(
    async (intent: string) => {
      await session.startSession(intent);
    },
    [session],
  );

  const handleAnswer = useCallback(
    async (cellKey: string, answer: string) => {
      await session.answerQuestion(cellKey, answer);
    },
    [session],
  );

  const handleCancel = useCallback(async () => {
    await session.cancelSession();
  }, [session]);

  // -- Return -------------------------------------------------------------

  return {
    // State
    buildPhase,
    cellStates,
    pendingQuestions,
    completeness,
    outputLines,
    buildError,
    isBuilding,
    isIdle,
    // Actions
    handleGenerate,
    handleAnswer,
    handleCancel,
  };
}
