import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePersonaStore } from "../personaStore";
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
    // Reset Zustand store to initial state between tests
    usePersonaStore.setState({
      personas: [],
      selectedPersonaId: null,
      selectedPersona: null,
      isLoading: false,
      error: null,
    });
    resetInvokeMocks();
  });

  describe("initial state", () => {
    it("has empty personas list", () => {
      const state = usePersonaStore.getState();
      expect(state.personas).toEqual([]);
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });

    it("has default UI state", () => {
      const state = usePersonaStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.isExecuting).toBe(false);
      expect(state.error).toBeNull();
      expect(state.editorTab).toBe("prompt");
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

      await usePersonaStore.getState().fetchPersonas();

      const state = usePersonaStore.getState();
      expect(state.personas).toHaveLength(2);
      expect(state.personas[0]?.id).toBe("p-1");
      expect(state.isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue(new Error("DB connection failed"));

      await usePersonaStore.getState().fetchPersonas();

      const state = usePersonaStore.getState();
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

      usePersonaStore.getState().selectPersona("p-1");

      const state = usePersonaStore.getState();
      expect(state.selectedPersonaId).toBe("p-1");
      expect(state.editorTab).toBe("prompt");
    });

    it("clears selection when null", () => {
      usePersonaStore.setState({ selectedPersonaId: "p-1" });

      usePersonaStore.getState().selectPersona(null);

      const state = usePersonaStore.getState();
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });
  });

  describe("UI actions", () => {
    it("setSidebarSection updates section", () => {
      usePersonaStore.getState().setSidebarSection("overview");
      expect(usePersonaStore.getState().sidebarSection).toBe("overview");
    });

    it("setEditorTab updates tab", () => {
      usePersonaStore.getState().setEditorTab("settings");
      expect(usePersonaStore.getState().editorTab).toBe("settings");
    });

    it("setError updates and clears error", () => {
      usePersonaStore.getState().setError("Something went wrong");
      expect(usePersonaStore.getState().error).toBe("Something went wrong");

      usePersonaStore.getState().setError(null);
      expect(usePersonaStore.getState().error).toBeNull();
    });

    it("setCredentialView updates view", () => {
      usePersonaStore.getState().setCredentialView("add-new");
      expect(usePersonaStore.getState().credentialView).toBe("add-new");
    });
  });

  describe("execution actions", () => {
    it("appendExecutionOutput appends lines", () => {
      usePersonaStore.getState().appendExecutionOutput("Line 1");
      usePersonaStore.getState().appendExecutionOutput("Line 2");

      expect(usePersonaStore.getState().executionOutput).toEqual(["Line 1", "Line 2"]);
    });

    it("clearExecutionOutput resets state", () => {
      usePersonaStore.setState({
        executionOutput: ["Line 1"],
        activeExecutionId: "exec-1",
        isExecuting: true,
      });

      usePersonaStore.getState().clearExecutionOutput();

      const state = usePersonaStore.getState();
      expect(state.executionOutput).toEqual([]);
      expect(state.activeExecutionId).toBeNull();
      expect(state.isExecuting).toBe(false);
    });

    it("finishExecution sets isExecuting to false", () => {
      usePersonaStore.setState({ isExecuting: true });

      usePersonaStore.getState().finishExecution();

      expect(usePersonaStore.getState().isExecuting).toBe(false);
    });
  });

  describe("deletePersona", () => {
    it("removes persona from list and clears selection if selected", async () => {
      mockInvokeMap({ delete_persona: undefined });

      usePersonaStore.setState({
        personas: [makePersona({ id: "p-1" }), makePersona({ id: "p-2" })],
        selectedPersonaId: "p-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        selectedPersona: { id: "p-1" } as any,
      });

      await usePersonaStore.getState().deletePersona("p-1");

      const state = usePersonaStore.getState();
      expect(state.personas).toHaveLength(1);
      expect(state.personas[0]?.id).toBe("p-2");
      expect(state.selectedPersonaId).toBeNull();
      expect(state.selectedPersona).toBeNull();
    });
  });
});
