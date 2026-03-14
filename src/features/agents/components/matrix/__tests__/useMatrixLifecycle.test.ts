import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks -- must be before import of the module under test
// ---------------------------------------------------------------------------

const mockTestN8nDraft = vi.fn().mockResolvedValue(undefined);
const mockValidateN8nDraft = vi.fn().mockResolvedValue({
  passed: true,
  error: null,
  output_preview: null,
  tool_issues: [],
});
const mockGetPersonaDetail = vi.fn().mockResolvedValue({
  id: "persona-1",
  name: "Test Agent",
  system_prompt: "You are helpful.",
  tools: [{ id: "tool-1", name: "slack", tool_type: "connector" }],
  triggers: [],
  subscriptions: [],
  automations: [],
});

vi.mock("@/api/agents/tests", () => ({
  testN8nDraft: (...args: unknown[]) => mockTestN8nDraft(...args),
  validateN8nDraft: (...args: unknown[]) => mockValidateN8nDraft(...args),
}));

vi.mock("@/api/agents/personas", () => ({
  getPersonaDetail: (...args: unknown[]) => mockGetPersonaDetail(...args),
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

vi.mock("@/stores/agentStore", () => {
  const getState = () => ({
    ...mockStoreState,
    handleStartTest: mockHandleStartTest,
    handleTestComplete: mockHandleTestComplete,
    handleTestFailed: mockHandleTestFailed,
    handleRejectTest: mockHandleRejectTest,
    appendTestOutput: mockAppendTestOutput,
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
    // Stub crypto.randomUUID
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- handleStartTest ---------------------------------------------------

  describe("handleStartTest", () => {
    it("generates a unique testId prefixed with 'build-test-'", async () => {
      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleStartTest).toHaveBeenCalledWith(
        "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
    });

    it("calls validateN8nDraft before testN8nDraft", async () => {
      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockValidateN8nDraft).toHaveBeenCalled();
      expect(mockTestN8nDraft).toHaveBeenCalled();
      // validateN8nDraft should be called before testN8nDraft
      const validateOrder = mockValidateN8nDraft.mock.invocationCallOrder[0];
      const testOrder = mockTestN8nDraft.mock.invocationCallOrder[0];
      expect(validateOrder).toBeLessThan(testOrder!);
    });

    it("aborts if validation fails", async () => {
      mockValidateN8nDraft.mockResolvedValueOnce({
        passed: false,
        error: "Missing tool scripts",
        output_preview: null,
        tool_issues: [{ tool_name: "slack", issue: "Script not found" }],
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockTestN8nDraft).not.toHaveBeenCalled();
      expect(mockHandleTestFailed).toHaveBeenCalledWith(
        expect.stringContaining("Missing tool scripts"),
      );
    });

    it("calls testN8nDraft with serialized persona draft JSON", async () => {
      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockTestN8nDraft).toHaveBeenCalledWith(
        "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        expect.any(String),
      );

      // Verify the draft JSON contains persona data
      const draftJson = mockTestN8nDraft.mock.calls[0]![1] as string;
      const parsed = JSON.parse(draftJson);
      expect(parsed.name).toBe("Test Agent");
      expect(parsed.tools).toBeDefined();
    });

    it("only starts when buildPhase is draft_ready", async () => {
      setStoreState({ buildPhase: "testing" });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleStartTest).not.toHaveBeenCalled();
      expect(mockTestN8nDraft).not.toHaveBeenCalled();
    });

    it("calls handleTestFailed on API error", async () => {
      mockTestN8nDraft.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      await act(async () => {
        await result.current.handleStartTest();
      });

      expect(mockHandleTestFailed).toHaveBeenCalledWith(
        expect.stringContaining("Network error"),
      );
    });
  });

  // -- Event listeners ---------------------------------------------------

  describe("n8n-test-status listener", () => {
    it("filters events by test_id", async () => {
      setStoreState({
        buildPhase: "testing",
        buildTestId: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      // Wait for listeners to be registered
      await act(async () => {});

      // Simulate event with wrong test_id
      simulateEvent("n8n-test-status", {
        test_id: "other-test-id",
        status: "completed",
        passed: true,
      });

      expect(mockHandleTestComplete).not.toHaveBeenCalled();
    });

    it("calls handleTestComplete on completed+passed status", async () => {
      setStoreState({
        buildPhase: "testing",
        buildTestId: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      simulateEvent("n8n-test-status", {
        test_id: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "completed",
        passed: true,
      });

      expect(mockHandleTestComplete).toHaveBeenCalledWith(true, "");
    });

    it("calls handleTestFailed on failed status", async () => {
      setStoreState({
        buildPhase: "testing",
        buildTestId: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      simulateEvent("n8n-test-status", {
        test_id: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "failed",
        error: "Assertion failed",
      });

      expect(mockHandleTestFailed).toHaveBeenCalledWith("Assertion failed");
    });
  });

  describe("n8n-test-output listener", () => {
    it("appends output lines via appendTestOutput", async () => {
      setStoreState({
        buildPhase: "testing",
        buildTestId: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      simulateEvent("n8n-test-output", {
        test_id: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        line: "Running test case 1...",
      });

      expect(mockAppendTestOutput).toHaveBeenCalledWith(
        "Running test case 1...",
      );
    });

    it("filters output events by test_id", async () => {
      setStoreState({
        buildPhase: "testing",
        buildTestId: "build-test-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });

      renderHook(() => useMatrixLifecycle({ personaId: "persona-1" }));

      await act(async () => {});

      simulateEvent("n8n-test-output", {
        test_id: "some-other-test",
        line: "Should be ignored",
      });

      expect(mockAppendTestOutput).not.toHaveBeenCalled();
    });
  });

  // -- handleApproveTest -------------------------------------------------

  describe("handleApproveTest", () => {
    it("returns true when buildTestPassed is true", () => {
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.handleApproveTest()).toBe(true);
    });

    it("returns false when buildTestPassed is not true", () => {
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: false,
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.handleApproveTest()).toBe(false);
    });

    it("returns false when buildPhase is not test_complete", () => {
      setStoreState({
        buildPhase: "testing",
        buildTestPassed: true,
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      expect(result.current.handleApproveTest()).toBe(false);
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
  });
});
