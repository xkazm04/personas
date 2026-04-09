import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../agentStore";

describe("matrixBuildSlice", () => {
  beforeEach(() => {
    // Reset slice to initial state between tests
    useAgentStore.getState().resetBuildSession();
  });

  describe("initial state", () => {
    it("has no active session", () => {
      const s = useAgentStore.getState();
      expect(s.buildSessionId).toBeNull();
    });

    it("has initializing as default phase", () => {
      const s = useAgentStore.getState();
      expect(s.buildPhase).toBe("initializing");
    });

    it("has empty cell states", () => {
      const s = useAgentStore.getState();
      expect(s.buildCellStates).toEqual({});
    });

    it("has empty pending questions array", () => {
      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions).toEqual([]);
    });

    it("has zero progress", () => {
      const s = useAgentStore.getState();
      expect(s.buildProgress).toBe(0);
    });

    it("has empty output lines", () => {
      const s = useAgentStore.getState();
      expect(s.buildOutputLines).toEqual([]);
    });

    it("has no error", () => {
      const s = useAgentStore.getState();
      expect(s.buildError).toBeNull();
    });

    it("has no draft", () => {
      const s = useAgentStore.getState();
      expect(s.buildDraft).toBeNull();
    });
  });

  describe("handleBuildCellUpdate", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("sets cell status from event", () => {
      useAgentStore.getState().handleBuildCellUpdate({
        type: "cell_update",
        session_id: "s1",
        cell_key: "connectors",
        data: { test: true },
        status: "resolved",
      });

      expect(useAgentStore.getState().buildCellStates["connectors"]).toBe("resolved");
    });

    it("merges without clobbering other cells", () => {
      const { handleBuildCellUpdate } = useAgentStore.getState();
      handleBuildCellUpdate({
        type: "cell_update",
        session_id: "s1",
        cell_key: "connectors",
        data: null,
        status: "resolved",
      });
      handleBuildCellUpdate({
        type: "cell_update",
        session_id: "s1",
        cell_key: "triggers",
        data: null,
        status: "filling",
      });

      const s = useAgentStore.getState();
      expect(s.buildCellStates["connectors"]).toBe("resolved");
      expect(s.buildCellStates["triggers"]).toBe("filling");
    });
  });

  describe("handleBuildQuestion", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("pushes question to buildPendingQuestions and marks cell as highlighted", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "use-cases",
        question: "What should this agent do?",
        options: ["Option A", "Option B"],
      });

      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions).toEqual([
        {
          cellKey: "use-cases",
          question: "What should this agent do?",
          options: ["Option A", "Option B"],
        },
      ]);
      expect(s.buildCellStates["use-cases"]).toBe("highlighted");
      expect(s.buildPhase).toBe("awaiting_input");
    });

    it("stores question with null options", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "memory",
        question: "How should memory work?",
        options: null,
      });

      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions[0]?.options).toBeNull();
    });

    it("supports multiple simultaneous questions", () => {
      const handle = useAgentStore.getState().handleBuildQuestion;
      handle({
        type: "question",
        session_id: "s1",
        cell_key: "use-cases",
        question: "What tasks?",
        options: ["A", "B"],
      });
      handle({
        type: "question",
        session_id: "s1",
        cell_key: "triggers",
        question: "When to run?",
        options: null,
      });

      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions).toHaveLength(2);
      expect(s.buildPendingQuestions[0]?.cellKey).toBe("use-cases");
      expect(s.buildPendingQuestions[1]?.cellKey).toBe("triggers");
      expect(s.buildCellStates["use-cases"]).toBe("highlighted");
      expect(s.buildCellStates["triggers"]).toBe("highlighted");
    });
  });

  describe("clearBuildQuestion", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("removes question by cellKey from the array", () => {
      // Setup: two pending questions
      const handle = useAgentStore.getState().handleBuildQuestion;
      handle({
        type: "question",
        session_id: "s1",
        cell_key: "use-cases",
        question: "What tasks?",
        options: null,
      });
      handle({
        type: "question",
        session_id: "s1",
        cell_key: "triggers",
        question: "When to run?",
        options: null,
      });

      // Clear one
      useAgentStore.getState().clearBuildQuestion("use-cases");

      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions).toHaveLength(1);
      expect(s.buildPendingQuestions[0]?.cellKey).toBe("triggers");
    });

    it("results in empty array when last question is cleared", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "connectors",
        question: "Which apps?",
        options: null,
      });

      useAgentStore.getState().clearBuildQuestion("connectors");

      const s = useAgentStore.getState();
      expect(s.buildPendingQuestions).toEqual([]);
    });

    it("does not change phase when clearing (let session_status events handle that)", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "connectors",
        question: "Which apps?",
        options: null,
      });

      expect(useAgentStore.getState().buildPhase).toBe("awaiting_input");

      useAgentStore.getState().clearBuildQuestion("connectors");

      // Phase stays at awaiting_input -- session_status events drive phase transitions
      expect(useAgentStore.getState().buildPhase).toBe("awaiting_input");
    });

    it("is a no-op for non-matching cellKey", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "connectors",
        question: "Which apps?",
        options: null,
      });

      useAgentStore.getState().clearBuildQuestion("nonexistent");

      expect(useAgentStore.getState().buildPendingQuestions).toHaveLength(1);
    });
  });

  describe("handleBuildProgress", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("updates progress when percent is provided", () => {
      useAgentStore.getState().handleBuildProgress({
        type: "progress",
        session_id: "s1",
        dimension: "identity",
        message: "Analyzing identity...",
        percent: 42,
      });

      expect(useAgentStore.getState().buildProgress).toBe(42);
    });

    it("does not change progress when percent is null", () => {
      // Set progress via event (not setState) so the session tracks it
      useAgentStore.getState().handleBuildProgress({
        type: "progress",
        session_id: "s1",
        dimension: null,
        message: "Initial",
        percent: 25,
      });
      expect(useAgentStore.getState().buildProgress).toBe(25);

      useAgentStore.getState().handleBuildProgress({
        type: "progress",
        session_id: "s1",
        dimension: null,
        message: "Still working...",
        percent: null,
      });

      expect(useAgentStore.getState().buildProgress).toBe(25);
    });

    it("appends message to output lines", () => {
      useAgentStore.getState().handleBuildProgress({
        type: "progress",
        session_id: "s1",
        dimension: null,
        message: "Step 1 done",
        percent: null,
      });
      useAgentStore.getState().handleBuildProgress({
        type: "progress",
        session_id: "s1",
        dimension: null,
        message: "Step 2 done",
        percent: null,
      });

      expect(useAgentStore.getState().buildOutputLines).toEqual([
        "Step 1 done",
        "Step 2 done",
      ]);
    });

    it("caps output lines at 500", () => {
      // Pre-fill with 499 lines via events so the session tracks them
      const handle = useAgentStore.getState().handleBuildProgress;
      for (let i = 0; i < 499; i++) {
        handle({ type: "progress", session_id: "s1", dimension: null, message: `Line ${i}`, percent: null });
      }
      expect(useAgentStore.getState().buildOutputLines.length).toBe(499);

      // Add 3 more lines (should cap at 500, dropping oldest)
      handle({ type: "progress", session_id: "s1", dimension: null, message: "New 1", percent: null });
      handle({ type: "progress", session_id: "s1", dimension: null, message: "New 2", percent: null });
      handle({ type: "progress", session_id: "s1", dimension: null, message: "New 3", percent: null });

      const lines = useAgentStore.getState().buildOutputLines;
      expect(lines.length).toBe(500);
      // Oldest lines should be dropped
      expect(lines[0]).toBe("Line 2");
      expect(lines[lines.length - 1]).toBe("New 3");
    });
  });

  describe("handleBuildError", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("sets error message and phase to failed", () => {
      useAgentStore.getState().handleBuildError({
        type: "error",
        session_id: "s1",
        cell_key: "connectors",
        message: "Connection timeout",
        retryable: true,
      });

      const s = useAgentStore.getState();
      expect(s.buildError).toBe("Connection timeout");
      expect(s.buildPhase).toBe("failed");
    });
  });

  describe("handleBuildSessionStatus", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("updates phase and calculates progress from counts", () => {
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: "s1",
        phase: "resolving",
        resolved_count: 3,
        total_count: 8,
      });

      const s = useAgentStore.getState();
      expect(s.buildPhase).toBe("resolving");
      expect(s.buildProgress).toBeCloseTo(37.5);
    });

    it("handles zero total count without dividing by zero", () => {
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: "s1",
        phase: "initializing",
        resolved_count: 0,
        total_count: 0,
      });

      expect(useAgentStore.getState().buildProgress).toBe(0);
    });

    it("sets buildPhase to testing from session_status event", () => {
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: "s1",
        phase: "testing",
        resolved_count: 8,
        total_count: 8,
      });

      expect(useAgentStore.getState().buildPhase).toBe("testing");
    });

    it("sets buildPhase to test_complete from session_status event", () => {
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: "s1",
        phase: "test_complete",
        resolved_count: 8,
        total_count: 8,
      });

      expect(useAgentStore.getState().buildPhase).toBe("test_complete");
    });

    it("sets buildPhase to promoted from session_status event", () => {
      useAgentStore.getState().handleBuildSessionStatus({
        type: "session_status",
        session_id: "s1",
        phase: "promoted",
        resolved_count: 8,
        total_count: 8,
      });

      expect(useAgentStore.getState().buildPhase).toBe("promoted");
    });
  });

  describe("handleStartTest", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("sets buildPhase to testing and stores testId", () => {
      useAgentStore.getState().handleStartTest("test-run-1");

      const s = useAgentStore.getState();
      expect(s.buildPhase).toBe("testing");
      expect(s.buildTestId).toBe("test-run-1");
    });

    it("clears previous test state when starting new test", () => {
      // Set up previous test state
      useAgentStore.setState({
        buildTestPassed: true,
        buildTestOutputLines: ["old output"],
        buildTestError: "old error",
      });

      useAgentStore.getState().handleStartTest("test-run-2");

      const s = useAgentStore.getState();
      expect(s.buildTestPassed).toBeNull();
      expect(s.buildTestOutputLines).toEqual([]);
      expect(s.buildTestError).toBeNull();
      expect(s.buildTestId).toBe("test-run-2");
    });
  });

  describe("handleTestComplete", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("sets testPassed=true, stores output preview, transitions to test_complete", () => {
      useAgentStore.getState().handleStartTest("test-run-1");
      useAgentStore.getState().handleTestComplete(true, "All 5 tests passed");

      const s = useAgentStore.getState();
      expect(s.buildTestPassed).toBe(true);
      expect(s.buildTestOutputLines).toEqual(["All 5 tests passed"]);
      expect(s.buildPhase).toBe("test_complete");
    });
  });

  describe("handleTestFailed", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("sets testPassed=false, stores error, transitions to test_complete", () => {
      useAgentStore.getState().handleStartTest("test-run-1");
      useAgentStore.getState().handleTestFailed("Assertion failed: expected 200 got 500");

      const s = useAgentStore.getState();
      expect(s.buildTestPassed).toBe(false);
      expect(s.buildTestError).toBe("Assertion failed: expected 200 got 500");
      expect(s.buildPhase).toBe("test_complete");
    });
  });

  describe("handleRejectTest", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("resets buildPhase to draft_ready and clears test state", () => {
      // Set up a test_complete state
      useAgentStore.setState({
        buildPhase: "test_complete",
        buildTestId: "test-run-1",
        buildTestPassed: false,
        buildTestOutputLines: ["Test output"],
        buildTestError: "Some error",
      });

      useAgentStore.getState().handleRejectTest();

      const s = useAgentStore.getState();
      expect(s.buildPhase).toBe("draft_ready");
      expect(s.buildTestId).toBeNull();
      expect(s.buildTestPassed).toBeNull();
      expect(s.buildTestOutputLines).toEqual([]);
      expect(s.buildTestError).toBeNull();
    });
  });

  describe("resetBuildSession", () => {
    it("resets all fields to initial state", () => {
      // First dirty the state
      useAgentStore.setState({
        buildSessionId: "s1",
        buildPhase: "resolving",
        buildCellStates: { connectors: "resolved" },
        buildPendingQuestions: [{ cellKey: "x", question: "?", options: null }],
        buildProgress: 75,
        buildOutputLines: ["line1", "line2"],
        buildError: "some error",
        buildDraft: { ir: true },
      });

      useAgentStore.getState().resetBuildSession();

      const s = useAgentStore.getState();
      expect(s.buildSessionId).toBeNull();
      expect(s.buildPhase).toBe("initializing");
      expect(s.buildCellStates).toEqual({});
      expect(s.buildPendingQuestions).toEqual([]);
      expect(s.buildProgress).toBe(0);
      expect(s.buildOutputLines).toEqual([]);
      expect(s.buildError).toBeNull();
      expect(s.buildDraft).toBeNull();
    });

    it("also resets all test lifecycle fields", () => {
      useAgentStore.setState({
        buildTestId: "test-run-1",
        buildTestPassed: true,
        buildTestOutputLines: ["test output"],
        buildTestError: "test error",
      });

      useAgentStore.getState().resetBuildSession();

      const s = useAgentStore.getState();
      expect(s.buildTestId).toBeNull();
      expect(s.buildTestPassed).toBeNull();
      expect(s.buildTestOutputLines).toEqual([]);
      expect(s.buildTestError).toBeNull();
    });
  });

  describe("hydrateBuildSession", () => {
    beforeEach(() => {
      useAgentStore.getState().createBuildSession("p-test", "s1");
    });

    it("wraps single pending_question into buildPendingQuestions array", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "session-abc",
        personaId: "p-1",
        phase: "awaiting_input",
        resolvedCells: {
          connectors: { tools: ["github"] },
          "use-cases": { name: "Code Review" },
        },
        pendingQuestion: {
          cellKey: "triggers",
          question: "When should this run?",
          options: ["On push", "On schedule"],
        },
        agentIr: { draft: "ir-data" },
        intent: "Build a code review agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      const s = useAgentStore.getState();
      expect(s.buildSessionId).toBe("session-abc");
      expect(s.buildPhase).toBe("awaiting_input");
      expect(s.buildCellStates["connectors"]).toBe("resolved");
      expect(s.buildCellStates["use-cases"]).toBe("resolved");
      expect(s.buildPendingQuestions).toEqual([
        {
          cellKey: "triggers",
          question: "When should this run?",
          options: ["On push", "On schedule"],
        },
      ]);
      expect(s.buildDraft).toEqual({ draft: "ir-data" });
    });

    it("sets empty array when pending_question is null", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "s2",
        personaId: "p-2",
        phase: "resolving",
        resolvedCells: { memory: { enabled: true } },
        pendingQuestion: null,
        agentIr: null,
        intent: "Build an agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      const s = useAgentStore.getState();
      expect(s.buildCellStates["memory"]).toBe("resolved");
      expect(s.buildPendingQuestions).toEqual([]);
      expect(s.buildDraft).toBeNull();
    });

    it("handles testing phase from persisted session", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "s3",
        personaId: "p-3",
        phase: "testing",
        resolvedCells: {},
        pendingQuestion: null,
        agentIr: null,
        intent: "Build an agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      expect(useAgentStore.getState().buildPhase).toBe("testing");
    });

    it("handles test_complete phase from persisted session", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "s4",
        personaId: "p-4",
        phase: "test_complete",
        resolvedCells: {},
        pendingQuestion: null,
        agentIr: null,
        intent: "Build an agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      expect(useAgentStore.getState().buildPhase).toBe("test_complete");
    });

    it("handles promoted phase from persisted session", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "s5",
        personaId: "p-5",
        phase: "promoted",
        resolvedCells: {},
        pendingQuestion: null,
        agentIr: null,
        intent: "Build an agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      expect(useAgentStore.getState().buildPhase).toBe("promoted");
    });
  });
});
