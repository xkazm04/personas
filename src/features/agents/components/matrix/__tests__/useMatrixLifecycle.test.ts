import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks -- must be before import of the module under test
// ---------------------------------------------------------------------------

const mockTestBuildDraft = vi.fn().mockResolvedValue({
  tools_tested: 1,
  tools_passed: 1,
  tools_failed: 0,
  tools_skipped: 0,
  credential_issues: [],
  results: [],
  summary: "1 passed",
});

const mockAnswerBuildQuestion = vi.fn().mockResolvedValue(undefined);

const mockPromoteBuildDraft = vi.fn().mockResolvedValue({
  persona: {},
  triggers_created: 2,
  tools_created: 3,
  connectors_needing_setup: [],
  entity_errors: [],
});

const mockUpdatePersona = vi.fn().mockResolvedValue({ id: "persona-1", name: "Test Agent", enabled: true });
const mockBuildUpdateInput = vi.fn((partial: Record<string, unknown>) => ({
  name: partial.name ?? null,
  description: partial.description ?? null,
  system_prompt: null,
  structured_prompt: null,
  icon: null,
  color: null,
  enabled: partial.enabled !== undefined ? partial.enabled : null,
  sensitive: null,
  headless: null,
  max_concurrent: null,
  timeout_ms: null,
  notification_channels: null,
  last_design_result: null,
  model_profile: null,
  max_budget_usd: null,
  max_turns: null,
  design_context: partial.design_context !== undefined ? partial.design_context : null,
  group_id: null,
}));

vi.mock("@/api/agents/buildSession", () => ({
  testBuildDraft: (...args: unknown[]) => mockTestBuildDraft(...args),
  answerBuildQuestion: (...args: unknown[]) => mockAnswerBuildQuestion(...args),
  promoteBuildDraft: (...args: unknown[]) => mockPromoteBuildDraft(...args),
}));

vi.mock("@/api/agents/personas", () => ({
  updatePersona: (...args: unknown[]) => mockUpdatePersona(...args),
  buildUpdateInput: (...args: unknown[]) => mockBuildUpdateInput(...args),
}));

vi.mock("@/api/system/system", () => ({
  sendAppNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/silentCatch", () => ({
  silentCatch: () => () => {},
}));

// Mock Tauri event listeners
type ListenerCallback = (event: { payload: Record<string, unknown> }) => void;
const listenerMap = new Map<string, ListenerCallback>();
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: ListenerCallback) => {
    listenerMap.set(eventName, callback);
    return mockUnlisten;
  }),
}));

// Mock store state
let mockStoreState: Record<string, unknown> = {};
const mockHandleStartTest = vi.fn();
const mockHandleTestComplete = vi.fn();
const mockHandleTestFailed = vi.fn();
const mockHandleRejectTest = vi.fn();
const mockAppendTestOutput = vi.fn();
const mockHandleBuildSessionStatus = vi.fn();
const mockSetToolTestResults = vi.fn();
const mockSetTestSummary = vi.fn();
const mockAppendToolTestResult = vi.fn();

vi.mock("@/stores/agentStore", () => {
  const getState = () => ({
    ...mockStoreState,
    handleStartTest: mockHandleStartTest,
    handleTestComplete: mockHandleTestComplete,
    handleTestFailed: mockHandleTestFailed,
    handleRejectTest: mockHandleRejectTest,
    appendTestOutput: mockAppendTestOutput,
    handleBuildSessionStatus: mockHandleBuildSessionStatus,
    setToolTestResults: mockSetToolTestResults,
    setTestSummary: mockSetTestSummary,
    appendToolTestResult: mockAppendToolTestResult,
  });

  const useAgentStore = vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) => {
      return selector(getState() as Record<string, unknown>);
    },
  );
  useAgentStore.getState = getState;

  return { useAgentStore };
});

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { useMatrixLifecycle } from "../useMatrixLifecycle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStoreState(overrides: Partial<Record<string, unknown>> = {}) {
  mockStoreState = {
    buildPhase: "draft_ready",
    buildTestId: null,
    buildTestPassed: null,
    buildTestOutputLines: [],
    buildTestError: null,
    buildToolTestResults: [],
    buildTestSummary: null,
    buildDraft: null,
    buildSessionId: null,
    buildConnectorLinks: {},
    ...overrides,
  };
}

function simulateEvent(eventName: string, payload: Record<string, unknown>) {
  const callback = listenerMap.get(eventName);
  if (callback) {
    callback({ payload });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMatrixLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenerMap.clear();
    setStoreState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- handleStartTest ---------------------------------------------------

  describe("handleStartTest", () => {
    it("generates a testId and calls handleStartTest on store", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleStartTest).toHaveBeenCalledWith(
        expect.stringMatching(/^test_\d+$/),
      );
    });

    it("calls testBuildDraft with sessionId and personaId", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockTestBuildDraft).toHaveBeenCalledWith("session-123", "persona-1");
    });

    it("calls handleTestComplete with true when all tools pass", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleTestComplete).toHaveBeenCalledWith(true, "1 passed");
    });

    it("only starts when buildPhase is draft_ready or test_complete", async () => {
      setStoreState({ buildPhase: "testing", buildSessionId: "session-123" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleStartTest).not.toHaveBeenCalled();
      expect(mockTestBuildDraft).not.toHaveBeenCalled();
    });

    it("calls handleTestFailed on API error", async () => {
      mockTestBuildDraft.mockRejectedValueOnce(new Error("Network error"));
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleTestFailed).toHaveBeenCalledWith("Network error");
    });

    it("reports failures correctly in summary", async () => {
      mockTestBuildDraft.mockResolvedValueOnce({
        tools_tested: 3,
        tools_passed: 2,
        tools_failed: 1,
        tools_skipped: 0,
        credential_issues: [],
        results: [],
      });

      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleTestComplete).toHaveBeenCalledWith(
        false,
        expect.stringContaining("failed"),
      );
    });
  });

  // -- Event listeners ---------------------------------------------------

  describe("build-test-tool-result listener", () => {
    it("registers a listener for build-test-tool-result events", async () => {
      setStoreState({
        buildPhase: "testing",
        buildSessionId: "session-123",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      expect(listenerMap.has("build-test-tool-result")).toBe(true);
    });

    it("filters events by session_id", async () => {
      setStoreState({
        buildPhase: "testing",
        buildSessionId: "session-123",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      // Simulate event with wrong session_id
      simulateEvent("build-test-tool-result", {
        session_id: "other-session",
        tool_name: "slack",
        status: "passed",
        tested: 1,
        total: 1,
      });

      expect(mockAppendToolTestResult).not.toHaveBeenCalled();
    });

    it("appends tool test result on matching session_id", async () => {
      setStoreState({
        buildPhase: "testing",
        buildSessionId: "session-123",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      simulateEvent("build-test-tool-result", {
        session_id: "session-123",
        tool_name: "slack",
        status: "passed",
        http_status: 200,
        latency_ms: 150,
        tested: 1,
        total: 1,
      });

      expect(mockAppendToolTestResult).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_name: "slack",
          status: "passed",
        }),
      );
      expect(mockAppendTestOutput).toHaveBeenCalled();
    });
  });

  // -- handleRefine ------------------------------------------------------

  describe("handleRefine", () => {
    it("calls answerBuildQuestion with _refine cellKey", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleRefine("Please update the Slack integration");
      });

      expect(mockAnswerBuildQuestion).toHaveBeenCalledWith(
        "session-123",
        "_refine",
        "Please update the Slack integration",
      );
    });

    it("resets test state by calling handleRejectTest before refining", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleRefine("Fix the tools");
      });

      expect(mockHandleRejectTest).toHaveBeenCalled();
    });

    it("only callable when buildPhase is draft_ready or test_complete", async () => {
      setStoreState({
        buildPhase: "testing",
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleRefine("some feedback");
      });

      expect(mockAnswerBuildQuestion).not.toHaveBeenCalled();
    });
  });

  // -- handlePromote ----------------------------------------------------

  describe("handlePromote", () => {
    it("calls promoteBuildDraft when draft has rich agent_ir", async () => {
      const draftIR = { system_prompt: "You are a bot", tools: ["slack"], triggers: [] };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handlePromote();
      });

      expect(mockPromoteBuildDraft).toHaveBeenCalledWith("session-123", "persona-1");
    });

    it("uses Rust promote path when session exists even without rich draft fields", async () => {
      const draftIR = { name: "Bot", description: "Desc" };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handlePromote();
      });

      expect(mockPromoteBuildDraft).toHaveBeenCalledWith("session-123", "persona-1");
    });

    it("transitions to promoted phase on success", async () => {
      const draftIR = { system_prompt: "You are a bot", tools: [] };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handlePromote();
      });

      expect(mockHandleBuildSessionStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session_status",
          phase: "promoted",
        }),
      );
    });

    it("returns PromoteResult with entity counts on success", async () => {
      const draftIR = { system_prompt: "You are a bot", tools: [] };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean; triggersCreated: number; toolsCreated: number } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(true);
      expect(promoteResult!.triggersCreated).toBe(2);
      expect(promoteResult!.toolsCreated).toBe(3);
    });

    it("guards against non-test_complete phase", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildTestPassed: true,
        buildDraft: { name: "Bot" },
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(false);
      expect(mockUpdatePersona).not.toHaveBeenCalled();
      expect(mockPromoteBuildDraft).not.toHaveBeenCalled();
    });

    it("guards against buildTestPassed not being true", async () => {
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: false,
        buildDraft: { name: "Bot" },
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(false);
      expect(mockUpdatePersona).not.toHaveBeenCalled();
      expect(mockPromoteBuildDraft).not.toHaveBeenCalled();
    });
  });

  // -- handleRejectTest --------------------------------------------------

  describe("handleRejectTest", () => {
    it("calls slice handleRejectTest action", () => {
      setStoreState({ buildPhase: "test_complete" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      result.current.handleRejectTest();

      expect(mockHandleRejectTest).toHaveBeenCalled();
    });
  });

  // -- Returned state ----------------------------------------------------

  describe("returned state", () => {
    it("exposes isTesting derived from buildPhase", () => {
      setStoreState({ buildPhase: "testing" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.isTesting).toBe(true);
    });

    it("exposes isTestComplete derived from buildPhase", () => {
      setStoreState({ buildPhase: "test_complete" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.isTestComplete).toBe(true);
    });

    it("exposes buildTestPassed from store", () => {
      setStoreState({ buildTestPassed: true });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.buildTestPassed).toBe(true);
    });

    it("exposes buildTestError from store", () => {
      setStoreState({ buildTestError: "Something failed" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.buildTestError).toBe("Something failed");
    });

    it("exposes buildTestOutputLines from store", () => {
      setStoreState({
        buildTestOutputLines: ["line 1", "line 2"],
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.buildTestOutputLines).toEqual([
        "line 1",
        "line 2",
      ]);
    });

    it("exposes buildToolTestResults from store", () => {
      const results = [{ tool_name: "slack", status: "passed" }];
      setStoreState({ buildToolTestResults: results });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.buildToolTestResults).toEqual(results);
    });

    it("exposes buildTestSummary from store", () => {
      setStoreState({ buildTestSummary: "3 passed, 0 failed" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.buildTestSummary).toBe("3 passed, 0 failed");
    });
  });
});
