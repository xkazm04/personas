// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/agents/automations", () => ({
  listAutomations: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  testAutomationWebhook: vi.fn(),
  deployAutomation: vi.fn(),
}));

import * as api from "@/api/agents/automations";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import { createAutomationSlice } from "./automationSlice";
import type { VaultStore } from "../../storeTypes";
import type { PersonaAutomation } from "@/lib/bindings/PersonaAutomation";

// The persona editor's Automations section renders the AGENT store's
// `selectedPersona.automations`; this slice's own list is empty on a fresh
// session. These tests start from that empty list on purpose.
function makeHarness(initial: PersonaAutomation[] = []) {
  let state = {} as VaultStore;
  const set = (partial: Partial<VaultStore> | ((s: VaultStore) => Partial<VaultStore>)) => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createAutomationSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice, automations: initial };
  return { get: () => state };
}

function automation(id: string, personaId: string): PersonaAutomation {
  return { id, personaId, name: id } as PersonaAutomation;
}

describe("automationSlice writes reach the section that renders them", () => {
  const changed: string[] = [];
  let off: () => void;

  beforeEach(() => {
    storeBus._reset();
    changed.length = 0;
    off = storeBus.on("automation:changed", ({ personaId }) => { changed.push(personaId); });
    storeBus.provide(AccessorKey.AGENTS_SELECTED_PERSONA_ID, () => "persona-1");
    vi.mocked(api.deleteAutomation).mockReset();
    vi.mocked(api.updateAutomation).mockReset();
    vi.mocked(api.deployAutomation).mockReset();
    return () => off();
  });

  it("deletes an automation this slice never loaded, and refreshes its persona", async () => {
    vi.mocked(api.deleteAutomation).mockResolvedValue(true);
    const h = makeHarness();
    await h.get().deleteAutomation("auto-1");
    expect(api.deleteAutomation).toHaveBeenCalledWith("auto-1");
    expect(changed).toEqual(["persona-1"]);
  });

  it("a refused delete announces nothing", async () => {
    vi.mocked(api.deleteAutomation).mockRejectedValue({ error: "nope", kind: "Validation" });
    const h = makeHarness([automation("auto-1", "persona-1")]);
    vi.mocked(api.listAutomations).mockResolvedValue([automation("auto-1", "persona-1")]);
    await h.get().deleteAutomation("auto-1");
    expect(changed).toEqual([]);
    expect(h.get().automations.map((a) => a.id)).toEqual(["auto-1"]);
  });

  it("an update (pause / resume) refreshes the owning persona", async () => {
    vi.mocked(api.updateAutomation).mockResolvedValue(automation("auto-1", "persona-7"));
    const h = makeHarness();
    await h.get().updateAutomation("auto-1", { deploymentStatus: "paused" });
    expect(changed).toEqual(["persona-7"]);
  });

  it("a deploy refreshes the owning persona", async () => {
    vi.mocked(api.deployAutomation).mockResolvedValue({
      automation: automation("auto-2", "persona-1"),
      platformUrl: null,
      webhookUrl: null,
      deploymentMessage: "ok",
    } as Awaited<ReturnType<typeof api.deployAutomation>>);
    const h = makeHarness();
    await h.get().deployAutomation({} as Parameters<typeof api.deployAutomation>[0]);
    expect(changed).toEqual(["persona-1"]);
  });
});
