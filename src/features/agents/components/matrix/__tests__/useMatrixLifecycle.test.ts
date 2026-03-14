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

vi.mock("@/api/agents/personas", () => ({
  getPersonaDetail: (...args: unknown[]) => mockGetPersonaDetail(...args),
  updatePersona: (...args: unknown[]) => mockUpdatePersona(...args),
  buildUpdateInput: (...args: unknown[]) => mockBuildUpdateInput(...args),
}));

const mockComputeCredentialCoverage = vi.fn().mockReturnValue({
  covered: true,
  missing: [],
  total: 1,
  linked: 1,
});

vi.mock("@/lib/validation/credentialCoverage", () => ({
  computeCredentialCoverage: (...args: unknown[]) => mockComputeCredentialCoverage(...args),
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

vi.mock("@/stores/agentStore", () => {
  const getState = () => ({
    ...mockStoreState,
    handleStartTest: mockHandleStartTest,
    handleTestComplete: mockHandleTestComplete,
    handleTestFailed: mockHandleTestFailed,
    handleRejectTest: mockHandleRejectTest,
    appendTestOutput: mockAppendTestOutput,
    handleBuildSessionStatus: mockHandleBuildSessionStatus,
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
    buildDraft: null,
    buildSessionId: null,
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

  // -- handleRefine ------------------------------------------------------

  describe("handleRefine", () => {
    const mockHandleGenerate = vi.fn().mockResolvedValue(undefined);

    it("starts a new build session with refinement text and previous agent_ir context", async () => {
      const draftIR = { name: "My Bot", description: "A helper", credential_links: {} };
      setStoreState({
        buildPhase: "draft_ready",
        buildDraft: draftIR,
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1", handleGenerate: mockHandleGenerate }),
      );

      await act(async () => {
        await result.current.handleRefine("Please update the Slack integration");
      });

      expect(mockHandleGenerate).toHaveBeenCalledWith(
        expect.stringContaining("[REFINEMENT]"),
        "persona-1",
      );
      expect(mockHandleGenerate).toHaveBeenCalledWith(
        expect.stringContaining("Please update the Slack integration"),
        "persona-1",
      );
    });

    it("includes previous buildDraft as JSON context in the intent string", async () => {
      const draftIR = { name: "My Bot", tools: ["slack"] };
      setStoreState({
        buildPhase: "draft_ready",
        buildDraft: draftIR,
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1", handleGenerate: mockHandleGenerate }),
      );

      await act(async () => {
        await result.current.handleRefine("Add email support");
      });

      const intent = mockHandleGenerate.mock.calls[0]![0] as string;
      expect(intent).toContain(JSON.stringify(draftIR));
    });

    it("resets test state by calling handleRejectTest before starting new session", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildDraft: { name: "Bot" },
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1", handleGenerate: mockHandleGenerate }),
      );

      await act(async () => {
        await result.current.handleRefine("Fix the tools");
      });

      // handleRejectTest resets test state (test ID, passed, output, error)
      expect(mockHandleRejectTest).toHaveBeenCalled();
    });

    it("only callable when buildPhase is draft_ready", async () => {
      setStoreState({
        buildPhase: "testing",
        buildDraft: { name: "Bot" },
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1", handleGenerate: mockHandleGenerate }),
      );

      await act(async () => {
        await result.current.handleRefine("some feedback");
      });

      expect(mockHandleGenerate).not.toHaveBeenCalled();
    });
  });

  // -- handlePromote ----------------------------------------------------

  describe("handlePromote", () => {
    it("calls updatePersona with enabled=true on the draft persona", async () => {
      const draftIR = { name: "Production Bot", description: "Does things", credential_links: { slack: "cred-1" } };
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

      expect(mockUpdatePersona).toHaveBeenCalledWith(
        "persona-1",
        expect.objectContaining({ enabled: true }),
      );
    });

    it("sets design_context with credential_links from buildDraft", async () => {
      const draftIR = { name: "Bot", description: "Desc", credential_links: { slack: "cred-1", github: "cred-2" } };
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

      expect(mockBuildUpdateInput).toHaveBeenCalledWith(
        expect.objectContaining({
          design_context: expect.stringContaining("credential_links"),
        }),
      );
    });

    it("checks credential coverage and rejects if missing credentials", async () => {
      mockComputeCredentialCoverage.mockReturnValueOnce({
        covered: false,
        missing: ["github_token"],
        total: 2,
        linked: 1,
      });

      const draftIR = { name: "Bot", description: "Desc", credential_links: { slack: "cred-1" } };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean; coverage: { covered: boolean; missing: string[] } } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(false);
      expect(promoteResult!.coverage.missing).toEqual(["github_token"]);
      expect(mockUpdatePersona).not.toHaveBeenCalled();
    });

    it("returns CoverageResult with missing list when coverage fails", async () => {
      mockComputeCredentialCoverage.mockReturnValueOnce({
        covered: false,
        missing: ["slack_token", "github_token"],
        total: 3,
        linked: 1,
      });

      const draftIR = { name: "Bot", credential_links: {} };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean; coverage: { missing: string[] } } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(false);
      expect(promoteResult!.coverage.missing).toContain("slack_token");
      expect(promoteResult!.coverage.missing).toContain("github_token");
    });

    it("transitions to promoted phase on success", async () => {
      const draftIR = { name: "Bot", description: "Desc", credential_links: { slack: "cred-1" } };
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

    it("returns success true with coverage when promotion succeeds", async () => {
      const draftIR = { name: "Bot", description: "Desc", credential_links: { slack: "cred-1" } };
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: true,
        buildDraft: draftIR,
        buildSessionId: "session-123",
      });

      const { result } = renderHook(() =>
        useMatrixLifecycle({ personaId: "persona-1" }),
      );

      let promoteResult: { success: boolean; coverage: { covered: boolean } } | undefined;
      await act(async () => {
        promoteResult = await result.current.handlePromote();
      });

      expect(promoteResult!.success).toBe(true);
      expect(promoteResult!.coverage.covered).toBe(true);
    });

    it("guards against non-test_complete phase", async () => {
      setStoreState({
        buildPhase: "draft_ready",
        buildTestPassed: true,
        buildDraft: { name: "Bot" },
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
    });

    it("guards against buildTestPassed not being true", async () => {
      setStoreState({
        buildPhase: "test_complete",
        buildTestPassed: false,
        buildDraft: { name: "Bot" },
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
