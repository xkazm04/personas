import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAgentStore } from "../agentStore";
import { useSystemStore } from "../systemStore";
import { mockInvokeMap, resetInvokeMocks } from "@/test/tauriMock";
import type { Persona } from "@/lib/bindings/Persona";

// Helper to create a minimal Persona fixture
function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "p-1",
    project_id: "proj-1",
    name: "Test Persona",
    description: null,
    system_prompt: "You are a test assistant.",
    structured_prompt: null,
    icon: null,
    color: null,
    enabled: true,
    sensitive: false,
    max_concurrent: 1,
    timeout_ms: 60000,
    notification_channels: null,
    last_design_result: null,
    model_profile: null,
    max_budget_usd: null,
    max_turns: null,
    design_context: null,
    group_id: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("personaStore", () => {
  beforeEach(() => {
    // Reset Zustand stores to initial state between tests
    useAgentStore.setState({
      personas: [],
      selectedPersonaId: null,
      selectedPersona: null,
      isLoading: false,
      error: null,
    });
    useSystemStore.setState({
      error: null,
    });
    resetInvokeMocks();
  });

  describe("initial state", () => {
    it("has empty personas list", () => {
      const state = useAgentStore.getState();
      expect(state.personas).toEqual([]);
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });

    it("has default UI state", () => {
      const agentState = useAgentStore.getState();
      const systemState = useSystemStore.getState();
      expect(agentState.isLoading).toBe(false);
      expect(agentState.isExecuting).toBe(false);
      expect(agentState.error).toBeNull();
      expect(systemState.editorTab).toBe("activity");
    });
  });

  describe("fetchPersonas", () => {
    it("loads personas from Tauri IPC", async () => {
      const personas = [makePersona({ id: "p-1" }), makePersona({ id: "p-2", name: "Second" })];
      mockInvokeMap({
        list_personas: personas,
        list_triggers: [],
        list_executions: [],
      });

      await useAgentStore.getState().fetchPersonas();

      const state = useAgentStore.getState();
      expect(state.personas).toHaveLength(2);
      expect(state.personas[0]?.id).toBe("p-1");
      expect(state.isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue(new Error("DB connection failed"));

      await expect(useAgentStore.getState().fetchPersonas()).rejects.toThrow("DB connection failed");

      const state = useAgentStore.getState();
      expect(state.error).toBe("DB connection failed");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("selectPersona", () => {
    it("sets selectedPersonaId and fetches detail", () => {
      mockInvokeMap({
        get_persona: makePersona({ id: "p-1" }),
        list_tool_definitions: [],
        list_triggers: [],
        list_subscriptions: [],
      });

      useAgentStore.getState().selectPersona("p-1");

      const state = useAgentStore.getState();
      expect(state.selectedPersonaId).toBe("p-1");
      expect(useSystemStore.getState().editorTab).toBe("use-cases");
    });

    it("clears selection when null", () => {
      useAgentStore.setState({ selectedPersonaId: "p-1" });

      useAgentStore.getState().selectPersona(null);

      const state = useAgentStore.getState();
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });
  });

  describe("UI actions", () => {
    it("setSidebarSection updates section", () => {
      useSystemStore.getState().setSidebarSection("overview");
      expect(useSystemStore.getState().sidebarSection).toBe("overview");
    });

    it("setEditorTab updates tab", () => {
      useSystemStore.getState().setEditorTab("settings");
      expect(useSystemStore.getState().editorTab).toBe("settings");
    });

    it("setError updates and clears error", () => {
      useSystemStore.getState().setError("Something went wrong");
      expect(useSystemStore.getState().error).toBe("Something went wrong");

      useSystemStore.getState().setError(null);
      expect(useSystemStore.getState().error).toBeNull();
    });

  });

  describe("execution actions", () => {
    it("appendExecutionOutput appends lines", async () => {
      useAgentStore.getState().appendExecutionOutput("Line 1");
      useAgentStore.getState().appendExecutionOutput("Line 2");

      await new Promise<void>((resolve) => queueMicrotask(resolve));

      expect(useAgentStore.getState().executionOutput).toEqual(["Line 1", "Line 2"]);
    });

    it("clearExecutionOutput resets state", () => {
      useAgentStore.setState({
        executionOutput: ["Line 1"],
        activeExecutionId: "exec-1",
        isExecuting: true,
      });

      useAgentStore.getState().clearExecutionOutput();

      const state = useAgentStore.getState();
      expect(state.executionOutput).toEqual([]);
      expect(state.activeExecutionId).toBeNull();
      expect(state.isExecuting).toBe(false);
    });

    it("finishExecution sets isExecuting to false", () => {
      useAgentStore.setState({ isExecuting: true });

      useAgentStore.getState().finishExecution();

      expect(useAgentStore.getState().isExecuting).toBe(false);
    });
  });

  describe("deletePersona", () => {
    it("removes persona from list and clears selection if selected", async () => {
      mockInvokeMap({ delete_persona: undefined });

      useAgentStore.setState({
        personas: [makePersona({ id: "p-1" }), makePersona({ id: "p-2" })],
        selectedPersonaId: "p-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        selectedPersona: { id: "p-1" } as any,
      });

      await useAgentStore.getState().deletePersona("p-1");

      const state = useAgentStore.getState();
      expect(state.personas).toHaveLength(1);
      expect(state.personas[0]?.id).toBe("p-2");
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });
  });
});
