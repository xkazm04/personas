/**
 * Lifecycle hook orchestrating the post-build test/approve/reject/refine/promote flow.
 *
 * After the matrix build reaches draft_ready, this hook handles:
 *   1. Starting a real API test via testBuildDraft (executes each tool against live APIs)
 *   2. Listening for streaming per-tool test results via Tauri events
 *   3. Promoting a tested draft to production (credential coverage + updatePersona)
 *   4. Rejecting a test and returning to draft_ready for refinement
 *   5. Refining: sending feedback through the build session conversation
 */
import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { EventName } from "@/lib/eventRegistry";
import { answerBuildQuestion, promoteBuildDraft, testBuildDraft } from "@/api/agents/buildSession";
import { sendAppNotification } from "@/api/system/system";
import { silentCatch } from "@/lib/silentCatch";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import {
  updatePersona,
  buildUpdateInput,
} from "@/api/agents/personas";
import type { PromoteBuildResult, ToolTestResult } from "@/lib/types/buildTypes";
import { useAgentStore } from "@/stores/agentStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("matrix-lifecycle");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMatrixLifecycleOptions {
  personaId: string | null;
  /** Callback to start a new build session (from useMatrixBuild.handleGenerate). */
  handleGenerate?: (intent: string, overridePersonaId?: string) => Promise<void>;
}

interface ToolTestEventPayload {
  session_id: string;
  tool_name: string;
  status: string;
  http_status?: number;
  latency_ms?: number;
  error?: string;
  connector?: string;
  tested: number;
  total: number;
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
  const buildTestPassed = useAgentStore((s) => s.buildTestPassed);
  const buildTestError = useAgentStore((s) => s.buildTestError);
  const buildTestOutputLines = useAgentStore((s) => s.buildTestOutputLines);
  const buildToolTestResults = useAgentStore((s) => s.buildToolTestResults);
  const buildTestSummary = useAgentStore((s) => s.buildTestSummary);
  const buildTestConnectors = useAgentStore((s) => s.buildTestConnectors);

  // -- Event listeners for per-tool test results ----------------------------

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    async function setup() {
      unlisten = await listen<ToolTestEventPayload>(
        EventName.BUILD_TEST_TOOL_RESULT,
        (event) => {
          if (cancelled) return;
          const store = useAgentStore.getState();
          if (!store.buildSessionId || event.payload.session_id !== store.buildSessionId) return;

          const result: ToolTestResult = {
            tool_name: event.payload.tool_name,
            status: event.payload.status as ToolTestResult["status"],
            http_status: event.payload.http_status,
            latency_ms: event.payload.latency_ms,
            error: event.payload.error,
            connector: event.payload.connector,
          };
          store.appendToolTestResult(result);
          store.appendTestOutput(
            `${result.status === "passed" ? "PASS" : result.status === "skipped" ? "SKIP" : "FAIL"} ${result.tool_name}${result.http_status ? ` (${result.http_status})` : ""}${result.latency_ms ? ` ${result.latency_ms}ms` : ""}`
          );
        },
      );
    }

    setup();
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // -- handleStartTest -------------------------------------------------------
  // Calls testBuildDraft which executes each tool against real APIs

  const handleStartTest = useCallback(async () => {
    // Always read fresh from the store — closure `personaId` can be stale
    // when the component remounts (React Suspense / lazy) while the Zustand
    // store already holds the correct ids from the running session.
    const state = useAgentStore.getState();
    if (state.buildPhase !== "draft_ready" && state.buildPhase !== "test_complete") return;


    const effectivePersonaId = state.buildPersonaId || personaId;
    const sessionId = state.buildSessionId;

    if (!sessionId || !effectivePersonaId) {
      logger.warn("Cannot start test: missing sessionId or personaId",
        { sessionId, storePersonaId: state.buildPersonaId, closurePersonaId: personaId, buildPhase: state.buildPhase });
      return;
    }

    // Optimistic: transition to testing immediately
    const testId = `test_${Date.now()}`;
    useAgentStore.getState().handleStartTest(testId);

    try {
      const report = await testBuildDraft(sessionId, effectivePersonaId);

      // Store full results, summary, and connector resolution
      const store = useAgentStore.getState();
      store.setToolTestResults(report.results);
      if (report.summary) store.setTestSummary(report.summary);
      if (report.connectors_resolved) store.setTestConnectors(report.connectors_resolved);

      // All passed = no failures AND at least something ran or was auto-verified
      const totalTools = report.tools_passed + report.tools_failed + report.tools_skipped;
      const allPassed = report.tools_failed === 0 && totalTools > 0;
      const summary = report.tools_failed === 0
        ? `${report.tools_passed} passed${report.tools_skipped > 0 ? `, ${report.tools_skipped} skipped` : ''}`
        : `${report.tools_passed}/${report.tools_tested} passed, ${report.tools_failed} failed${report.credential_issues.length > 0 ? `, ${report.credential_issues.length} credential issue(s)` : ""}`;
      store.handleTestComplete(allPassed, summary);
      sendAppNotification(
        allPassed ? 'Agent Test Passed' : 'Agent Test Complete',
        allPassed ? `All ${report.tools_passed} tools passed. Ready to promote.` : summary,
      ).catch(silentCatch("lifecycle:testComplete"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run tests";
      useAgentStore.getState().handleTestFailed(message);
      sendAppNotification('Agent Test Failed', message).catch(silentCatch("lifecycle:testFailed"));
    }
  }, [personaId]);

  // -- handleRefine -----------------------------------------------------------
  // Sends a _refine message through the build session conversation

  const handleRefine = useCallback(
    async (feedback: string) => {
      const state = useAgentStore.getState();
      if (state.buildPhase !== "draft_ready" && state.buildPhase !== "test_complete") return;

      const sessionId = state.buildSessionId;
      if (!sessionId) return;

      // Reset test state before refining
      useAgentStore.getState().handleRejectTest();

      try {
        await answerBuildQuestion(sessionId, "_refine", feedback);
      } catch (err) {
        logger.error("Refinement failed", { error: err });
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

    const effectivePid = personaId || state.buildPersonaId;
    if (!effectivePid) {
      return emptyResult;
    }

    const sessionId = state.buildSessionId;
    if (!sessionId) {
      return emptyResult;
    }

    try {
      const agentIR = state.buildDraft as Record<string, unknown> | null;
      // Check for rich draft data OR the presence of a build session (which stores
      // agent_ir on the Rust side even when buildDraft is null in the frontend).
      // Template adoptions via bridge don't populate buildDraft but DO create
      // a session with agent_ir — the Rust promote reads from agent_ir directly.
      const hasRichDraft = agentIR?.system_prompt || agentIR?.tools || agentIR?.triggers
        || agentIR?.structured_prompt || agentIR?.suggested_tools || agentIR?.suggested_triggers
        || sessionId;  // Always use Rust promote path when a session exists

      if (hasRichDraft) {
        // New path: use atomic promote that creates entities from agent_ir
        const result: PromoteBuildResult = await promoteBuildDraft(sessionId, effectivePid);

        // Transition to promoted
        useAgentStore.getState().handleBuildSessionStatus({
          type: "session_status",
          session_id: sessionId,
          phase: "promoted",
          resolved_count: 8,
          total_count: 8,
        });

        sendAppNotification('Agent Promoted', 'Your agent has been promoted to production and is ready to use.').catch(silentCatch("lifecycle:promoted"));
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

        await updatePersona(effectivePid, input);

        useAgentStore.getState().handleBuildSessionStatus({
          type: "session_status",
          session_id: sessionId,
          phase: "promoted",
          resolved_count: 8,
          total_count: 8,
        });

        sendAppNotification('Agent Promoted', 'Your agent has been promoted to production and is ready to use.').catch(silentCatch("lifecycle:promoted"));
        return { ...emptyResult, success: true };
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message
        : typeof err === "string" ? err
        : (err as Record<string, unknown>)?.error ? String((err as Record<string, unknown>).error)
        : "Promotion failed";
      logger.error("handlePromote failed", { message });
      return emptyResult;
    }
  }, [personaId]);

  // -- handleRejectTest ------------------------------------------------------

  const handleRejectTest = useCallback(() => {
    const state = useAgentStore.getState();
    state.handleRejectTest();
    // Also reset the DB session phase back to draft_ready so re-testing works
    const sessionId = state.buildSessionId;
    if (sessionId) {
      invokeWithTimeout("reset_build_session_phase", { sessionId }).catch(() => {});
    }
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
    buildToolTestResults,
    buildTestSummary,
    buildTestConnectors,
    isTesting: buildPhase === "testing",
    isTestComplete: buildPhase === "test_complete",
  };
}
