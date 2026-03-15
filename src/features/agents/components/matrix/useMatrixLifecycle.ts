/**
 * Lifecycle hook orchestrating the post-build test/approve/reject/refine/promote flow.
 *
 * After the matrix build reaches draft_ready, this hook handles:
 *   1. Starting a test run via testN8nDraft (with pre-validation)
 *   2. Listening for streaming test output and status events
 *   3. Promoting a tested draft to production (credential coverage + updatePersona)
 *   4. Rejecting a test and returning to draft_ready for refinement
 *   5. Refining: starting a new build session with previous agent_ir context
 *
 * Uses testN8nDraft (single-turn, streaming, confusion detection) rather
 * than startTestRun (full multi-model test runner) per RESEARCH.md.
 */
import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { answerBuildQuestion, promoteBuildDraft } from "@/api/agents/buildSession";
import {
  updatePersona,
  buildUpdateInput,
} from "@/api/agents/personas";
import type { PromoteBuildResult } from "@/lib/types/buildTypes";
import { useAgentStore } from "@/stores/agentStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMatrixLifecycleOptions {
  personaId: string | null;
  /** Callback to start a new build session (from useMatrixBuild.handleGenerate). */
  handleGenerate?: (intent: string, overridePersonaId?: string) => Promise<void>;
}

interface TestStatusPayload {
  test_id: string;
  status: "running" | "completed" | "failed";
  error?: string;
  passed?: boolean;
}

interface TestOutputPayload {
  test_id: string;
  line: string;
}

export interface PromoteResult {
  success: boolean;
  triggersCreated: number;
  toolsCreated: number;
  connectorsNeedingSetup: string[];
  entityErrors: Array<{ entity_type: string; entity_name: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMatrixLifecycle({
  personaId,
}: UseMatrixLifecycleOptions) {
  // -- Read build slice state from Zustand selectors -------------------------

  const buildPhase = useAgentStore((s) => s.buildPhase);
  const buildTestId = useAgentStore((s) => s.buildTestId);
  const buildTestPassed = useAgentStore((s) => s.buildTestPassed);
  const buildTestError = useAgentStore((s) => s.buildTestError);
  const buildTestOutputLines = useAgentStore((s) => s.buildTestOutputLines);

  // Ref to track current testId for event filtering in listeners
  const testIdRef = useRef<string | null>(buildTestId);
  testIdRef.current = buildTestId;

  // -- Event listeners -------------------------------------------------------

  useEffect(() => {
    let statusUnlisten: (() => void) | null = null;
    let outputUnlisten: (() => void) | null = null;
    let cancelled = false;

    async function setupListeners() {
      statusUnlisten = await listen<TestStatusPayload>(
        "n8n-test-status",
        (event) => {
          if (cancelled) return;
          const currentTestId = testIdRef.current;
          if (!currentTestId || event.payload.test_id !== currentTestId) return;

          if (event.payload.status === "completed") {
            useAgentStore
              .getState()
              .handleTestComplete(event.payload.passed === true, "");
          } else if (event.payload.status === "failed") {
            useAgentStore
              .getState()
              .handleTestFailed(event.payload.error ?? "Test failed");
          }
        },
      );

      outputUnlisten = await listen<TestOutputPayload>(
        "n8n-test-output",
        (event) => {
          if (cancelled) return;
          const currentTestId = testIdRef.current;
          if (!currentTestId || event.payload.test_id !== currentTestId) return;

          useAgentStore.getState().appendTestOutput(event.payload.line);
        },
      );
    }

    setupListeners();

    return () => {
      cancelled = true;
      statusUnlisten?.();
      outputUnlisten?.();
    };
  }, []);

  // -- handleStartTest -------------------------------------------------------
  // Sends a _test message through the build session conversation

  const handleStartTest = useCallback(async () => {
    const state = useAgentStore.getState();
    if (state.buildPhase !== "draft_ready") return;

    const sessionId = state.buildSessionId;
    if (!sessionId) return;

    try {
      // Send test request through the build session conversation
      await answerBuildQuestion(sessionId, "_test", "Run test");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start test";
      useAgentStore.getState().handleTestFailed(message);
    }
  }, []);

  // -- handleRefine -----------------------------------------------------------
  // Sends a _refine message through the build session conversation

  const handleRefine = useCallback(
    async (feedback: string) => {
      const state = useAgentStore.getState();
      if (state.buildPhase !== "draft_ready") return;

      const sessionId = state.buildSessionId;
      if (!sessionId) return;

      try {
        // Send refinement through the build session conversation
        await answerBuildQuestion(sessionId, "_refine", feedback);
      } catch (err) {
        console.error("Refinement failed:", err);
      }
    },
    [],
  );

  // -- handlePromote ----------------------------------------------------------

  const handlePromote = useCallback(async (): Promise<PromoteResult> => {
    const state = useAgentStore.getState();
    const emptyResult: PromoteResult = {
      success: false,
      triggersCreated: 0,
      toolsCreated: 0,
      connectorsNeedingSetup: [],
      entityErrors: [],
    };

    // Guard: only callable when test_complete and test passed
    if (state.buildPhase !== "test_complete" || state.buildTestPassed !== true) {
      return emptyResult;
    }

    if (!personaId) {
      return emptyResult;
    }

    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return emptyResult;
    }

    try {
      const agentIR = state.buildDraft as Record<string, unknown> | null;
      const hasRichDraft = agentIR?.system_prompt || agentIR?.tools || agentIR?.triggers;

      if (hasRichDraft) {
        // New path: use atomic promote that creates entities from agent_ir
        const result: PromoteBuildResult = await promoteBuildDraft(sessionId, personaId);

        // Transition to promoted
        useAgentStore.getState().handleBuildSessionStatus({
          type: "session_status",
          session_id: sessionId,
          phase: "promoted",
          resolved_count: 8,
          total_count: 8,
        });

        return {
          success: true,
          triggersCreated: result.triggers_created,
          toolsCreated: result.tools_created,
          connectorsNeedingSetup: result.connectors_needing_setup,
          entityErrors: result.entity_errors,
        };
      } else {
        // Fallback: old-format agent_ir without entities — just enable the persona
        const input = buildUpdateInput({
          enabled: true,
          design_context: JSON.stringify({
            credential_links: state.buildConnectorLinks,
          }),
          name: (agentIR?.name as string) ?? undefined,
          description: (agentIR?.description as string) ?? undefined,
        });

        await updatePersona(personaId, input);

        useAgentStore.getState().handleBuildSessionStatus({
          type: "session_status",
          session_id: sessionId,
          phase: "promoted",
          resolved_count: 8,
          total_count: 8,
        });

        return { ...emptyResult, success: true };
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Promotion failed";
      console.error("handlePromote failed:", message);
      return emptyResult;
    }
  }, [personaId]);

  // -- handleRejectTest ------------------------------------------------------

  const handleRejectTest = useCallback(() => {
    useAgentStore.getState().handleRejectTest();
  }, []);

  // -- Return ----------------------------------------------------------------

  return {
    handleStartTest,
    handlePromote,
    handleRefine,
    handleRejectTest,
    buildTestPassed,
    buildTestError,
    buildTestOutputLines,
    isTesting: buildPhase === "testing",
    isTestComplete: buildPhase === "test_complete",
  };
}
