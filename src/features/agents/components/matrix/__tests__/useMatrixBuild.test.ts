import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks -- must be before import of the module under test
// ---------------------------------------------------------------------------

const mockStartSession = vi.fn().mockResolvedValue("session-123");
const mockAnswerQuestion = vi.fn().mockResolvedValue(undefined);
const mockCancelSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/build/useBuildSession", () => ({
  useBuildSession: vi.fn(() => ({
    startSession: mockStartSession,
    answerQuestion: mockAnswerQuestion,
    cancelSession: mockCancelSession,
  })),
}));

// Mock store state -- each test can override via mockStoreState
let mockStoreState: Record<string, unknown> = {};

vi.mock("@/stores/agentStore", () => {
  const getState = () => mockStoreState;

  // The useAgentStore mock supports both:
  //   useAgentStore(selectorFn) -- returns selectorFn(mockStoreState)
  //   useAgentStore.getState() -- returns mockStoreState
  const useAgentStore = vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    return selector(mockStoreState);
  });
  useAgentStore.getState = getState;

  return { useAgentStore };
});

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { useMatrixBuild } from "../useMatrixBuild";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStoreState(overrides: Partial<Record<string, unknown>> = {}) {
  mockStoreState = {
    buildPhase: "initializing",
    buildCellStates: {},
    buildPendingQuestions: [],
    buildProgress: 0,
    buildOutputLines: [],
    buildError: null,
    buildSessionId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMatrixBuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  // -- Completeness --------------------------------------------------------

  describe("completeness", () => {
    it("returns 0 when no cells are resolved", () => {
      setStoreState({ buildCellStates: {} });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.completeness).toBe(0);
    });

    it("returns 50 when 4 of 8 cells are resolved", () => {
      setStoreState({
        buildCellStates: {
          "use-cases": "resolved",
          connectors: "resolved",
          triggers: "resolved",
          "human-review": "resolved",
          memory: "filling",
          "error-handling": "pending",
          messages: "hidden",
          events: "hidden",
        },
      });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.completeness).toBe(50);
    });

    it("returns 100 when all 8 cells are resolved", () => {
      setStoreState({
        buildCellStates: {
          "use-cases": "resolved",
          connectors: "resolved",
          triggers: "resolved",
          "human-review": "resolved",
          memory: "resolved",
          "error-handling": "resolved",
          messages: "resolved",
          events: "resolved",
        },
      });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.completeness).toBe(100);
    });

    it("rounds to nearest integer", () => {
      // 3 of 8 = 37.5 -> 38
      setStoreState({
        buildCellStates: {
          "use-cases": "resolved",
          connectors: "resolved",
          triggers: "resolved",
        },
      });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.completeness).toBe(38);
    });
  });

  // -- isBuilding ----------------------------------------------------------

  describe("isBuilding", () => {
    it("is true when buildPhase is 'analyzing'", () => {
      setStoreState({ buildPhase: "analyzing" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isBuilding).toBe(true);
    });

    it("is true when buildPhase is 'resolving'", () => {
      setStoreState({ buildPhase: "resolving" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isBuilding).toBe(true);
    });

    it("is false when buildPhase is 'initializing'", () => {
      setStoreState({ buildPhase: "initializing" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isBuilding).toBe(false);
    });

    it("is false when buildPhase is 'completed'", () => {
      setStoreState({ buildPhase: "completed" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isBuilding).toBe(false);
    });

    it("is false when buildPhase is 'awaiting_input'", () => {
      setStoreState({ buildPhase: "awaiting_input" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isBuilding).toBe(false);
    });
  });

  // -- isIdle --------------------------------------------------------------

  describe("isIdle", () => {
    it("is true when phase is 'initializing' and no session ID", () => {
      setStoreState({ buildPhase: "initializing", buildSessionId: null });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isIdle).toBe(true);
    });

    it("is false when phase is 'initializing' but session ID exists", () => {
      setStoreState({
        buildPhase: "initializing",
        buildSessionId: "session-123",
      });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isIdle).toBe(false);
    });

    it("is false when phase is 'analyzing'", () => {
      setStoreState({ buildPhase: "analyzing", buildSessionId: null });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.isIdle).toBe(false);
    });
  });

  // -- Action delegation --------------------------------------------------

  describe("handleGenerate", () => {
    it("calls session.startSession with the intent text", async () => {
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );

      await act(async () => {
        await result.current.handleGenerate("Build a Slack bot");
      });

      expect(mockStartSession).toHaveBeenCalledWith("Build a Slack bot", undefined);
    });
  });

  describe("handleAnswer", () => {
    it("calls session.answerQuestion with cellKey and answer", async () => {
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );

      await act(async () => {
        await result.current.handleAnswer("connectors", "Use Slack API");
      });

      expect(mockAnswerQuestion).toHaveBeenCalledWith(
        "connectors",
        "Use Slack API",
      );
    });
  });

  describe("handleCancel", () => {
    it("calls session.cancelSession", async () => {
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );

      await act(async () => {
        await result.current.handleCancel();
      });

      expect(mockCancelSession).toHaveBeenCalled();
    });
  });

  // -- State passthrough ---------------------------------------------------

  describe("state passthrough", () => {
    it("exposes buildPhase from store", () => {
      setStoreState({ buildPhase: "resolving" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.buildPhase).toBe("resolving");
    });

    it("exposes cellStates from store", () => {
      const states = { "use-cases": "resolved", connectors: "filling" };
      setStoreState({ buildCellStates: states });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.cellStates).toEqual(states);
    });

    it("exposes pendingQuestions from store", () => {
      const questions = [
        { cellKey: "connectors", question: "Which API?", options: null },
      ];
      setStoreState({ buildPendingQuestions: questions });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.pendingQuestions).toEqual(questions);
    });

    it("exposes outputLines from store", () => {
      setStoreState({ buildOutputLines: ["line 1", "line 2"] });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.outputLines).toEqual(["line 1", "line 2"]);
    });

    it("exposes buildError from store", () => {
      setStoreState({ buildError: "Something broke" });
      const { result } = renderHook(() =>
        useMatrixBuild({ personaId: "p1" }),
      );
      expect(result.current.buildError).toBe("Something broke");
    });
  });
});
