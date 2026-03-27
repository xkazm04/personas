import { describe, it, expect, beforeEach } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listPersonas,
  getPersona,
  createPersona,
  updatePersona,
  duplicatePersona,
  deletePersona,
  getPersonaBlastRadius,
  getPersonaSummaries,
  exportPersona,
  importPersona,
  operationToPartial,
  buildUpdateInput,
} from "@/api/agents/personas";

const mockedInvoke = vi.mocked(invoke);

const stubPersona = {
  id: "p-1",
  project_id: "proj-1",
  name: "Test",
  description: null,
  system_prompt: "prompt",
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
};

describe("api/agents/personas", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listPersonas calls list_personas", async () => {
    mockInvoke("list_personas", [stubPersona]);
    const result = await listPersonas();
    expect(result).toEqual([stubPersona]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_personas", undefined, undefined);
  });

  it("getPersona calls get_persona with id", async () => {
    mockInvoke("get_persona", stubPersona);
    const result = await getPersona("p-1");
    expect(result).toEqual(stubPersona);
  });

  it("createPersona calls create_persona", async () => {
    mockInvoke("create_persona", stubPersona);
    const result = await createPersona({ name: "Test", system_prompt: "prompt" } as unknown);
    expect(result).toEqual(stubPersona);
  });

  it("updatePersona calls update_persona", async () => {
    const updated = { ...stubPersona, name: "Updated" };
    mockInvoke("update_persona", updated);
    const result = await updatePersona("p-1", { name: "Updated" } as unknown);
    expect(result).toEqual(updated);
  });

  it("duplicatePersona calls duplicate_persona", async () => {
    mockInvoke("duplicate_persona", { ...stubPersona, id: "p-2" });
    const result = await duplicatePersona("p-1");
    expect(result.id).toBe("p-2");
  });

  it("deletePersona calls delete_persona", async () => {
    mockInvoke("delete_persona", true);
    const result = await deletePersona("p-1");
    expect(result).toBe(true);
  });

  it("getPersonaBlastRadius returns items", async () => {
    const items = [{ category: "triggers", description: "2 triggers" }];
    mockInvoke("persona_blast_radius", items);
    const result = await getPersonaBlastRadius("p-1");
    expect(result).toEqual(items);
  });

  it("getPersonaSummaries calls get_persona_summaries", async () => {
    mockInvoke("get_persona_summaries", []);
    const result = await getPersonaSummaries();
    expect(result).toEqual([]);
  });

  it("exportPersona returns boolean", async () => {
    mockInvoke("export_persona", true);
    const result = await exportPersona("p-1");
    expect(result).toBe(true);
  });

  it("importPersona returns null when cancelled", async () => {
    mockInvoke("import_persona", null);
    const result = await importPersona();
    expect(result).toBeNull();
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_personas", "not found");
    await expect(listPersonas()).rejects.toThrow("not found");
  });

  // Pure function tests (no IPC)
  it("operationToPartial maps SwitchModel", () => {
    const result = operationToPartial({ kind: "SwitchModel", model_profile: "gpt-4", max_budget_usd: 10, max_turns: 5 });
    expect(result).toEqual({ model_profile: "gpt-4", max_budget_usd: 10, max_turns: 5 });
  });

  it("operationToPartial maps ToggleEnabled", () => {
    const result = operationToPartial({ kind: "ToggleEnabled", enabled: false });
    expect(result).toEqual({ enabled: false });
  });

  it("buildUpdateInput sets null for unset fields", () => {
    const input = buildUpdateInput({ name: "New" });
    expect(input.name).toBe("New");
    expect(input.system_prompt).toBeNull();
    expect(input.enabled).toBeNull();
  });

  // =========================================================================
  // Option<Option<T>> update contract tests
  //
  // Rust uses Option<Option<T>> for nullable fields:
  //   None          = skip (don't touch the DB column)
  //   Some(None)    = clear (set column to NULL)
  //   Some(Some(v)) = set (set column to v)
  //
  // buildUpdateInput translates JS partial updates into UpdatePersonaInput.
  // These tests verify the three semantics survive the JS → JSON boundary.
  // =========================================================================

  describe("Option<Option<T>> update contract", () => {
    it("sets a field when value is provided", () => {
      const input = buildUpdateInput({
        description: "new desc",
        icon: "rocket",
        max_budget_usd: 10.5,
        max_turns: 20,
      });

      // Option<Option<T>> fields with values → value (will become Some(Some(v)) in Rust)
      expect(input.description).toBe("new desc");
      expect(input.icon).toBe("rocket");
      expect(input.max_budget_usd).toBe(10.5);
      expect(input.max_turns).toBe(20);
    });

    it("clears a field when explicit null is provided", () => {
      // JS explicit null should signal "clear this field to NULL in DB"
      const input = buildUpdateInput({
        description: null,
        icon: null,
        color: null,
        max_budget_usd: null,
        max_turns: null,
        design_context: null,
        group_id: null,
      });

      // When the caller explicitly passes null, buildUpdateInput should
      // forward null. On the Rust side, serde deserializes this as None (skip),
      // which means the "clear" intent is lost at the JSON boundary.
      // This documents the current behavior — null = skip, same as omitting.
      expect(input.description).toBeNull();
      expect(input.icon).toBeNull();
      expect(input.color).toBeNull();
      expect(input.max_budget_usd).toBeNull();
      expect(input.max_turns).toBeNull();
      expect(input.design_context).toBeNull();
      expect(input.group_id).toBeNull();
    });

    it("skips a field when key is omitted (undefined)", () => {
      // An empty partial: all fields are undefined → all become null (skip)
      const input = buildUpdateInput({});

      // Option<T> fields: null = skip
      expect(input.name).toBeNull();
      expect(input.system_prompt).toBeNull();
      expect(input.enabled).toBeNull();
      expect(input.sensitive).toBeNull();

      // Option<Option<T>> fields: null = skip
      expect(input.description).toBeNull();
      expect(input.icon).toBeNull();
      expect(input.color).toBeNull();
      expect(input.model_profile).toBeNull();
      expect(input.max_budget_usd).toBeNull();
    });

    it("explicit null and omitted key produce identical JSON for Option<Option<T>> fields", () => {
      // This is the critical edge case: JS null and JS undefined both become
      // null in the output, which means the Rust backend cannot distinguish
      // "clear this field" from "don't touch this field" at the JSON boundary.
      const withExplicitNull = buildUpdateInput({ description: null });
      const withOmittedKey = buildUpdateInput({});

      expect(withExplicitNull.description).toBeNull();
      expect(withOmittedKey.description).toBeNull();
      expect(withExplicitNull.description).toBe(withOmittedKey.description);

      // Same for numeric Option<Option<T>> fields
      const nullBudget = buildUpdateInput({ max_budget_usd: null });
      const omittedBudget = buildUpdateInput({});
      expect(nullBudget.max_budget_usd).toBe(omittedBudget.max_budget_usd);
    });
  });
});
