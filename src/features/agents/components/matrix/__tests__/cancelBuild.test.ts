import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks -- must be before import of the module under test
// ---------------------------------------------------------------------------

const mockStartSession = vi.fn().mockResolvedValue("session-cancel-test");
const mockAnswerQuestion = vi.fn().mockResolvedValue(undefined);
const mockSubmitAllAnswers = vi.fn().mockResolvedValue(undefined);
const mockCancelSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/build/useBuildSession", () => ({
  useBuildSession: vi.fn(() => ({
    startSession: mockStartSession,
    answerQuestion: mockAnswerQuestion,
    submitAllAnswers: mockSubmitAllAnswers,
    cancelSession: mockCancelSession,
  })),
}));

// Mock store state -- each test can override via setStoreState
let mockStoreState: Record<string, unknown> = {};

vi.mock("@/stores/agentStore", () => {
  const getState = () => mockStoreState;

  const useAgentStore = vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) => {
      return selector(mockStoreState);
    },
  );
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
    buildCellData: {},
    buildPendingQuestions: [],
    buildProgress: 0,
    buildOutputLines: [],
    buildError: null,
    buildSessionId: null,
    buildTestPassed: null,
    buildTestOutputLines: [],
    buildTestError: null,
    buildActivity: null,
    buildPendingAnswers: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests -- MTRX-09: Cancel build path
// ---------------------------------------------------------------------------

describe("cancelBuild (MTRX-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it("handleCancel invokes cancelSession on the build session", async () => {
    setStoreState({
      buildPhase: "resolving",
      buildSessionId: "session-active",
    });

    const { result } = renderHook(() =>
      useMatrixBuild({ personaId: "persona-1" }),
    );

    await act(async () => {
      await result.current.handleCancel();
    });

    expect(mockCancelSession).toHaveBeenCalledTimes(1);
  });

  it("after cancel, buildPhase resets to 'initializing' and buildPendingQuestions empties", () => {
    // Simulate the post-cancel store state that resetBuildSession produces.
    // The real resetBuildSession (in matrixBuildSlice) sets buildPhase to
    // "initializing" and buildPendingQuestions to []. Here we verify that
    // useMatrixBuild exposes these reset values correctly.
    setStoreState({
      buildPhase: "initializing",
      buildPendingQuestions: [],
      buildSessionId: null,
    });

    const { result } = renderHook(() =>
      useMatrixBuild({ personaId: "persona-1" }),
    );

    expect(result.current.buildPhase).toBe("initializing");
    expect(result.current.pendingQuestions).toEqual([]);
    expect(result.current.isIdle).toBe(true);
  });

  it("handleCancel can be called even when no session is active", async () => {
    setStoreState({ buildPhase: "initializing", buildSessionId: null });

    const { result } = renderHook(() =>
      useMatrixBuild({ personaId: "persona-1" }),
    );

    // Should not throw
    await act(async () => {
      await result.current.handleCancel();
    });

    expect(mockCancelSession).toHaveBeenCalledTimes(1);
  });
});
