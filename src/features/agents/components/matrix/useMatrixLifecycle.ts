/**
 * Lifecycle hook orchestrating the post-build test/approve/reject flow.
 *
 * After the matrix build reaches draft_ready, this hook handles:
 *   1. Starting a test run via testN8nDraft (with pre-validation)
 *   2. Listening for streaming test output and status events
 *   3. Approve (stub -- Plan 03 replaces with handlePromote)
 *   4. Reject (returns to draft_ready for refinement)
 *
 * Uses testN8nDraft (single-turn, streaming, confusion detection) rather
 * than startTestRun (full multi-model test runner) per RESEARCH.md.
 */
import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { testN8nDraft, validateN8nDraft } from "@/api/agents/tests";
import { getPersonaDetail } from "@/api/agents/personas";
import { useAgentStore } from "@/stores/agentStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMatrixLifecycleOptions {
  personaId: string | null;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMatrixLifecycle({ personaId }: UseMatrixLifecycleOptions) {
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

  const handleStartTest = useCallback(async () => {
    const currentPhase = useAgentStore.getState().buildPhase;
    if (currentPhase !== "draft_ready") return;
    if (!personaId) return;

    // Generate unique test ID
    const testId = `build-test-${crypto.randomUUID()}`;

    // Transition phase to testing
    useAgentStore.getState().handleStartTest(testId);

    try {
      // Load persona detail to construct draft JSON
      const detail = await getPersonaDetail(personaId);

      // Serialize as draft JSON for the test
      const draftJson = JSON.stringify({
        name: detail.name,
        system_prompt: detail.system_prompt,
        tools: detail.tools,
        triggers: detail.triggers,
      });

      // Validate first
      const validation = await validateN8nDraft(draftJson);
      if (!validation.passed) {
        useAgentStore
          .getState()
          .handleTestFailed(
            validation.error ?? "Draft validation failed",
          );
        return;
      }

      // Start the streaming test
      await testN8nDraft(testId, draftJson);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start test";
      useAgentStore.getState().handleTestFailed(message);
    }
  }, [personaId]);

  // -- handleApproveTest (stub for Plan 03) ----------------------------------

  const handleApproveTest = useCallback(() => {
    const state = useAgentStore.getState();
    if (state.buildPhase !== "test_complete" || state.buildTestPassed !== true) {
      return false;
    }
    // Stub: Plan 03 replaces this with handlePromote
    return true;
  }, []);

  // -- handleRejectTest ------------------------------------------------------

  const handleRejectTest = useCallback(() => {
    useAgentStore.getState().handleRejectTest();
  }, []);

  // -- Return ----------------------------------------------------------------

  return {
    handleStartTest,
    handleApproveTest,
    handleRejectTest,
    buildTestPassed,
    buildTestError,
    buildTestOutputLines,
    isTesting: buildPhase === "testing",
    isTestComplete: buildPhase === "test_complete",
  };
}
