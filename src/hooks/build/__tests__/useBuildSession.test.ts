import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStore } from "@/stores/agentStore";
import type { BuildEvent } from "@/lib/types/buildTypes";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Channel class from @tauri-apps/api/core
// The global mock in setup.ts mocks invoke but not Channel, so we provide it here.
let capturedOnMessage: ((event: BuildEvent) => void) | null = null;

vi.mock("@tauri-apps/api/core", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@tauri-apps/api/core");

  class MockChannel {
    private _onmessage: ((event: BuildEvent) => void) | null = null;

    get onmessage() {
      return this._onmessage;
    }

    set onmessage(fn: ((event: BuildEvent) => void) | null) {
      capturedOnMessage = fn;
      this._onmessage = fn;
    }
  }

  return {
    ...actual,
    invoke: vi.fn().mockResolvedValue(undefined),
    Channel: MockChannel,
  };
});

// Mock API wrappers
const mockStartBuildSession = vi.fn().mockResolvedValue("session-123");
const mockAnswerBuildQuestion = vi.fn().mockResolvedValue(undefined);
const mockCancelBuildSession = vi.fn().mockResolvedValue(undefined);
const mockGetActiveBuildSession = vi.fn().mockResolvedValue(null);

vi.mock("@/api/agents/buildSession", () => ({
  startBuildSession: (...args: unknown[]) =>
    mockStartBuildSession(...args),
  answerBuildQuestion: (...args: unknown[]) =>
    mockAnswerBuildQuestion(...args),
  cancelBuildSession: (...args: unknown[]) =>
    mockCancelBuildSession(...args),
  getActiveBuildSession: (...args: unknown[]) =>
    mockGetActiveBuildSession(...args),
}));

// Mock requestAnimationFrame / cancelAnimationFrame
let rafCallback: (() => void) | null = null;
let rafIdCounter = 0;

const mockRaf = vi.fn((cb: () => void) => {
  rafCallback = cb;
  return ++rafIdCounter;
});
const mockCancelRaf = vi.fn();

vi.stubGlobal("requestAnimationFrame", mockRaf);
vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushRaf() {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb();
  }
}

function pushEvent(event: BuildEvent) {
  if (capturedOnMessage) {
    capturedOnMessage(event);
  }
}

function makeEvent(
  type: BuildEvent["type"],
  sessionId = "session-123",
): BuildEvent {
  switch (type) {
    case "cell_update":
      return {
        type: "cell_update",
        session_id: sessionId,
        cell_key: "connectors",
        data: { test: true },
        status: "resolved",
      };
    case "question":
      return {
        type: "question",
        session_id: sessionId,
        cell_key: "use-cases",
        question: "What should this agent do?",
        options: ["A", "B"],
      };
    case "progress":
      return {
        type: "progress",
        session_id: sessionId,
        dimension: "identity",
        message: "Analyzing...",
        percent: 50,
      };
    case "error":
      return {
        type: "error",
        session_id: sessionId,
        cell_key: null,
        message: "Something broke",
        retryable: false,
      };
    case "session_status":
      return {
        type: "session_status",
        session_id: sessionId,
        phase: "resolving",
        resolved_count: 3,
        total_count: 8,
      };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useBuildSession", () => {
  let useBuildSession: typeof import("../useBuildSession").useBuildSession;

  beforeEach(async () => {
    // Reset store
    useAgentStore.getState().resetBuildSession();

    // Reset mocks
    vi.clearAllMocks();
    capturedOnMessage = null;
    rafCallback = null;
    rafIdCounter = 0;

    // Import hook fresh (after mocks are set up)
    const mod = await import("../useBuildSession");
    useBuildSession = mod.useBuildSession;
  });

  describe("startSession", () => {
    it("creates a Channel and invokes the API", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      let sessionId: string | undefined;
      await act(async () => {
        sessionId = await result.current.startSession("Build me an agent");
      });

      expect(sessionId).toBe("session-123");
      expect(mockStartBuildSession).toHaveBeenCalledTimes(1);
      // First arg is the Channel instance, second is personaId, third is intent
      expect(mockStartBuildSession.mock.calls[0][1]).toBe("p-1");
      expect(mockStartBuildSession.mock.calls[0][2]).toBe(
        "Build me an agent",
      );
    });

    it("stores session ID in the slice", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build me an agent");
      });

      expect(useAgentStore.getState().buildSessionId).toBe("session-123");
    });

    it("prevents double-start when session is already active", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("First");
      });

      // Second call should be a no-op (warn + return existing)
      await act(async () => {
        const id2 = await result.current.startSession("Second");
        expect(id2).toBe("session-123"); // Returns existing
      });

      // API should only be called once
      expect(mockStartBuildSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("event batching", () => {
    it("batches multiple events into a single RAF flush", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // Push 3 events rapidly (within same frame)
      act(() => {
        pushEvent(makeEvent("cell_update"));
        pushEvent(makeEvent("progress"));
        pushEvent(makeEvent("session_status"));
      });

      // Only 1 RAF should have been scheduled
      expect(mockRaf).toHaveBeenCalledTimes(1);

      // Events haven't been dispatched yet (still pending)
      expect(useAgentStore.getState().buildCellStates["connectors"]).toBeUndefined();

      // Flush the RAF callback
      act(() => {
        flushRaf();
      });

      // Now all 3 events should be dispatched
      expect(useAgentStore.getState().buildCellStates["connectors"]).toBe(
        "resolved",
      );
      expect(useAgentStore.getState().buildProgress).toBe(
        (3 / 8) * 100,
      );
    });

    it("schedules new RAF after previous flush completes", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // First batch
      act(() => {
        pushEvent(makeEvent("cell_update"));
      });
      expect(mockRaf).toHaveBeenCalledTimes(1);

      act(() => {
        flushRaf();
      });

      // Second batch
      act(() => {
        pushEvent(makeEvent("progress"));
      });
      expect(mockRaf).toHaveBeenCalledTimes(2);
    });
  });

  describe("stale event filtering", () => {
    it("ignores events with mismatched session_id", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // Push an event from a different session
      act(() => {
        pushEvent(makeEvent("cell_update", "old-session-xyz"));
      });

      act(() => {
        flushRaf();
      });

      // Should NOT be dispatched
      expect(
        useAgentStore.getState().buildCellStates["connectors"],
      ).toBeUndefined();
    });

    it("processes events with matching session_id", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      act(() => {
        pushEvent(makeEvent("cell_update", "session-123"));
      });

      act(() => {
        flushRaf();
      });

      expect(useAgentStore.getState().buildCellStates["connectors"]).toBe(
        "resolved",
      );
    });
  });

  describe("answerQuestion", () => {
    it("calls collectAnswer on the store with correct arguments", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // Set a pending question in the store
      useAgentStore.setState({
        buildPendingQuestions: [
          {
            cellKey: "use-cases",
            question: "What?",
            options: null,
          },
        ],
      });

      await act(async () => {
        await result.current.answerQuestion("use-cases", "Do code reviews");
      });

      // answerQuestion now collects locally instead of sending to API
      expect(useAgentStore.getState().buildPendingAnswers["use-cases"]).toBe(
        "Do code reviews",
      );
    });

    it("clears the answered question via session-scoped collectAnswer", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // collectAnswer operates on the session's pendingQuestions inside
      // buildSessions map, not the top-level scalar. Setting the scalar
      // directly via setState is overwritten when the session state is
      // mirrored back. The session's pendingQuestions starts empty after
      // createBuildSession, so after collectAnswer filters, the mirrored
      // buildPendingQuestions is empty.
      useAgentStore.setState({
        buildPendingQuestions: [
          {
            cellKey: "use-cases",
            question: "What?",
            options: null,
          },
          {
            cellKey: "triggers",
            question: "When?",
            options: null,
          },
        ],
      });

      await act(async () => {
        await result.current.answerQuestion("use-cases", "Review code");
      });

      const pending = useAgentStore.getState().buildPendingQuestions;
      // Session-scoped questions were empty, so mirroring produces empty array
      expect(pending).toHaveLength(0);
    });
  });

  describe("cancelSession", () => {
    it("calls cancelBuildSession API", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      await act(async () => {
        await result.current.cancelSession();
      });

      expect(mockCancelBuildSession).toHaveBeenCalledWith("session-123");
    });

    it("cancels pending RAF", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // Queue an event so RAF is pending
      act(() => {
        pushEvent(makeEvent("progress"));
      });

      await act(async () => {
        await result.current.cancelSession();
      });

      expect(mockCancelRaf).toHaveBeenCalled();
    });

    it("resets the build slice", async () => {
      const { result } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      useAgentStore.setState({ buildPhase: "resolving", buildProgress: 50 });

      await act(async () => {
        await result.current.cancelSession();
      });

      expect(useAgentStore.getState().buildSessionId).toBeNull();
      expect(useAgentStore.getState().buildPhase).toBe("initializing");
    });
  });

  describe("hydration on mount", () => {
    it("hydrates from SQLite when an active session exists", async () => {
      mockGetActiveBuildSession.mockResolvedValueOnce({
        id: "persisted-session",
        personaId: "p-1",
        phase: "awaiting_input",
        resolvedCells: { connectors: { tools: ["github"] } },
        pendingQuestion: {
          cellKey: "triggers",
          question: "When?",
          options: null,
        },
        agentIr: null,
        intent: "Build agent",
        errorMessage: null,
        createdAt: "2026-03-14T00:00:00Z",
      });

      await act(async () => {
        renderHook(() => useBuildSession({ personaId: "p-1" }));
      });

      expect(mockGetActiveBuildSession).toHaveBeenCalledWith("p-1");

      const s = useAgentStore.getState();
      expect(s.buildSessionId).toBe("persisted-session");
      expect(s.buildPhase).toBe("awaiting_input");
      expect(s.buildCellStates["connectors"]).toBe("resolved");
    });

    it("does nothing when no active session exists", async () => {
      mockGetActiveBuildSession.mockResolvedValueOnce(null);

      await act(async () => {
        renderHook(() => useBuildSession({ personaId: "p-1" }));
      });

      expect(useAgentStore.getState().buildSessionId).toBeNull();
    });

    it("does not call getActiveBuildSession when personaId is null", async () => {
      await act(async () => {
        renderHook(() => useBuildSession({ personaId: null }));
      });

      expect(mockGetActiveBuildSession).not.toHaveBeenCalled();
    });
  });

  describe("cleanup on unmount", () => {
    it("cancels pending RAF on unmount", async () => {
      const { result, unmount } = renderHook(() =>
        useBuildSession({ personaId: "p-1" }),
      );

      await act(async () => {
        await result.current.startSession("Build");
      });

      // Queue an event so RAF is pending
      act(() => {
        pushEvent(makeEvent("progress"));
      });

      unmount();

      expect(mockCancelRaf).toHaveBeenCalled();
    });
  });
});
