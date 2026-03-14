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
import { testN8nDraft, validateN8nDraft } from "@/api/agents/tests";
import {
  getPersonaDetail,
  updatePersona,
  buildUpdateInput,
} from "@/api/agents/personas";
import { computeCredentialCoverage } from "@/lib/validation/credentialCoverage";
import type { CoverageResult } from "@/lib/validation/credentialCoverage";
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
  coverage: CoverageResult;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMatrixLifecycle({
  personaId,
  handleGenerate,
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

  // -- handleRefine -----------------------------------------------------------

  const handleRefine = useCallback(
    async (feedback: string) => {
      const state = useAgentStore.getState();
      if (state.buildPhase !== "draft_ready") return;
      if (!personaId || !handleGenerate) return;

      // Read the previous agent_ir (buildDraft) for context
      const buildDraft = state.buildDraft;

      // Reset test state since we're going back to building
      state.handleRejectTest();

      // Construct refinement intent with previous context
      const refinementIntent =
        "[REFINEMENT] Previous build context: " +
        JSON.stringify(buildDraft) +
        "\n\nUser refinement: " +
        feedback;

      // Start a NEW build session with the refinement intent
      await handleGenerate(refinementIntent, personaId);
    },
    [personaId, handleGenerate],
  );

  // -- handlePromote ----------------------------------------------------------

  const handlePromote = useCallback(async (): Promise<PromoteResult> => {
    const state = useAgentStore.getState();

    // Guard: only callable when test_complete and test passed
    if (state.buildPhase !== "test_complete" || state.buildTestPassed !== true) {
      return {
        success: false,
        coverage: { covered: false, missing: [], total: 0, linked: 0 },
      };
    }

    if (!personaId) {
      return {
        success: false,
        coverage: { covered: false, missing: [], total: 0, linked: 0 },
      };
    }

    try {
      // Load persona detail to get current tools
      const detail = await getPersonaDetail(personaId);

      // Parse credential_links from buildDraft (agent_ir)
      const agentIR = state.buildDraft as Record<string, unknown> | null;
      const credentialLinks =
        (agentIR?.credential_links as Record<string, string> | undefined) ?? null;

      // Run credential coverage check
      const coverage = computeCredentialCoverage(detail.tools, credentialLinks);

      if (!coverage.covered) {
        return { success: false, coverage };
      }

      // Promote: update persona with enabled=true and design_context
      const input = buildUpdateInput({
        enabled: true,
        design_context: JSON.stringify({
          credential_links: credentialLinks,
        }),
        name: (agentIR?.name as string) ?? undefined,
        description: (agentIR?.description as string) ?? undefined,
      });

      await updatePersona(personaId, input);

      // Transition to promoted via session status update
      const sessionId = state.buildSessionId as string;
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: sessionId,
        phase: "promoted",
        resolved_count: 8,
        total_count: 8,
      });

      return { success: true, coverage };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Promotion failed";
      console.error("handlePromote failed:", message);
      return {
        success: false,
        coverage: { covered: false, missing: [], total: 0, linked: 0 },
      };
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
