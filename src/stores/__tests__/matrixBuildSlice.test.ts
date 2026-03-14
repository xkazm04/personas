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

    it("has no current question", () => {
      const s = useAgentStore.getState();
      expect(s.buildCurrentQuestion).toBeNull();
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
    it("sets current question and marks cell as highlighted", () => {
      useAgentStore.getState().handleBuildQuestion({
        type: "question",
        session_id: "s1",
        cell_key: "use-cases",
        question: "What should this agent do?",
        options: ["Option A", "Option B"],
      });

      const s = useAgentStore.getState();
      expect(s.buildCurrentQuestion).toEqual({
        cellKey: "use-cases",
        question: "What should this agent do?",
        options: ["Option A", "Option B"],
      });
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
      expect(s.buildCurrentQuestion?.options).toBeNull();
    });
  });

  describe("handleBuildProgress", () => {
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
      useAgentStore.setState({ buildProgress: 25 });
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
      // Pre-fill with 499 lines
      useAgentStore.setState({
        buildOutputLines: Array.from({ length: 499 }, (_, i) => `Line ${i}`),
      });

      // Add 3 more lines (should cap at 500, dropping oldest)
      const handle = useAgentStore.getState().handleBuildProgress;
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
  });

  describe("resetBuildSession", () => {
    it("resets all fields to initial state", () => {
      // First dirty the state
      useAgentStore.setState({
        buildSessionId: "s1",
        buildPhase: "resolving",
        buildCellStates: { connectors: "resolved" },
        buildCurrentQuestion: { cellKey: "x", question: "?", options: null },
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
      expect(s.buildCurrentQuestion).toBeNull();
      expect(s.buildProgress).toBe(0);
      expect(s.buildOutputLines).toEqual([]);
      expect(s.buildError).toBeNull();
      expect(s.buildDraft).toBeNull();
    });
  });

  describe("hydrateBuildSession", () => {
    it("populates all fields from PersistedBuildSession", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "session-abc",
        persona_id: "p-1",
        phase: "awaiting_input",
        resolved_cells: {
          connectors: { tools: ["github"] },
          "use-cases": { name: "Code Review" },
        },
        pending_question: {
          cellKey: "triggers",
          question: "When should this run?",
          options: ["On push", "On schedule"],
        },
        agent_ir: { draft: "ir-data" },
        intent: "Build a code review agent",
        error_message: null,
        created_at: "2026-03-14T00:00:00Z",
      });

      const s = useAgentStore.getState();
      expect(s.buildSessionId).toBe("session-abc");
      expect(s.buildPhase).toBe("awaiting_input");
      expect(s.buildCellStates["connectors"]).toBe("resolved");
      expect(s.buildCellStates["use-cases"]).toBe("resolved");
      expect(s.buildCurrentQuestion).toEqual({
        cellKey: "triggers",
        question: "When should this run?",
        options: ["On push", "On schedule"],
      });
      expect(s.buildDraft).toEqual({ draft: "ir-data" });
    });

    it("sets cells from resolved_cells as resolved status", () => {
      useAgentStore.getState().hydrateBuildSession({
        id: "s2",
        persona_id: "p-2",
        phase: "resolving",
        resolved_cells: { memory: { enabled: true } },
        pending_question: null,
        agent_ir: null,
        intent: "Build an agent",
        error_message: null,
        created_at: "2026-03-14T00:00:00Z",
      });

      const s = useAgentStore.getState();
      expect(s.buildCellStates["memory"]).toBe("resolved");
      expect(s.buildCurrentQuestion).toBeNull();
      expect(s.buildDraft).toBeNull();
    });
  });
});
