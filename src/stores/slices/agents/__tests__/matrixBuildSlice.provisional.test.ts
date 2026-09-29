import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../../../agentStore";

/**
 * The first build turn's streaming preview (backend: engine/build_session/
 * provisional.rs) is held APART from confirmed state. Contract: the
 * authoritative pass fully replaces the preview, so `provisional_settled`
 * (sent after the turn's confirmed events) and any build error drop it whole,
 * and nothing provisional ever reaches `capabilities` / `cellStates`.
 */

const SID = "s1";

function store() {
  return useAgentStore.getState();
}

function previewEnumeration(ids: string[]) {
  store().handleProvisionalCapabilityEnumeration({
    type: "provisional_capability_enumeration",
    session_id: SID,
    data: { capabilities: ids.map((id) => ({ id, title: `Title ${id}` })) },
  });
}

function previewResolution(capability_id: string, field: string, value: unknown, cell_key: string | null = null) {
  store().handleProvisionalCapabilityResolution({
    type: "provisional_capability_resolution",
    session_id: SID,
    capability_id,
    field,
    value,
    cell_key,
  });
}

describe("matrixBuildSlice — provisional first-turn preview", () => {
  beforeEach(() => {
    store().resetBuildSession();
    store().createBuildSession("p-1", SID);
  });

  it("holds previewed capabilities and fields apart from confirmed state", () => {
    previewEnumeration(["uc_a", "uc_b"]);
    previewResolution("uc_a", "suggested_trigger", { trigger_type: "schedule" }, "triggers");
    previewResolution("uc_a", "tool_hints", ["x"]);

    const s = store();
    expect(s.buildProvisional.order).toEqual(["uc_a", "uc_b"]);
    expect(s.buildProvisional.capabilities.uc_a?.fields.suggested_trigger).toEqual({ trigger_type: "schedule" });
    // The backend's cell verdict is kept per field; a field with no frame has none.
    expect(s.buildProvisional.capabilities.uc_a?.cells).toEqual({ suggested_trigger: "triggers" });
    expect(s.buildProvisional.capabilities.uc_b?.cells).toEqual({});
    expect(s.buildProvisional.capabilities.uc_b?.title).toBe("Title uc_b");
    // Nothing confirmed, nothing resolved.
    expect(s.buildCapabilities).toEqual({});
    expect(s.buildCapabilityOrder).toEqual([]);
    expect(s.buildCellStates).toEqual({});
  });

  it("a resolution before any enumeration still lands as a stub", () => {
    previewResolution("uc_x", "connectors", ["gmail"]);
    expect(store().buildProvisional.order).toEqual(["uc_x"]);
    expect(store().buildProvisional.capabilities.uc_x?.fields.connectors).toEqual(["gmail"]);
  });

  it("settling drops the whole preview and keeps the authoritative pass", () => {
    previewEnumeration(["uc_a", "uc_gone"]);
    previewResolution("uc_a", "error_handling", "retry");

    // The authoritative pass lands first (backend order), then settles.
    store().handleCapabilityEnumerationUpdate({
      type: "capability_enumeration_update",
      session_id: SID,
      data: { capabilities: [{ id: "uc_a", title: "A" }] },
      status: "resolved",
    });
    store().handleProvisionalSettled({
      type: "provisional_settled",
      session_id: SID,
      retracted_capability_ids: ["uc_gone"],
      retracted_resolutions: [["uc_a", "error_handling"]],
    });

    const s = store();
    expect(s.buildProvisional.order).toEqual([]);
    expect(s.buildProvisional.capabilities).toEqual({});
    expect(s.buildCapabilityOrder).toEqual(["uc_a"]);
    expect(s.buildCapabilities.uc_gone).toBeUndefined();
  });

  it("a settle with nothing previewed is a no-op (no churn)", () => {
    const before = store().buildSessions[SID];
    store().handleProvisionalSettled({
      type: "provisional_settled",
      session_id: SID,
      retracted_capability_ids: [],
      retracted_resolutions: [],
    });
    expect(store().buildSessions[SID]).toBe(before);
  });

  it("a build error clears the preview (a failed turn never settles)", () => {
    previewEnumeration(["uc_a"]);
    store().handleBuildError({ type: "error", session_id: SID, cell_key: null, message: "stalled", retryable: true });
    expect(store().buildProvisional.order).toEqual([]);
  });

  it("previews for another session never leak into the active one", () => {
    store().createBuildSession("p-2", "s2");
    previewEnumeration(["uc_a"]); // targets s1, which is no longer active
    expect(store().buildProvisional.order).toEqual([]);
    expect(store().buildSessions[SID]?.provisional.order).toEqual(["uc_a"]);
  });
});
