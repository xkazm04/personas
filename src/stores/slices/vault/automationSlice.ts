import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { PersonaAutomation } from "@/lib/bindings/PersonaAutomation";
import type { AutomationRun } from "@/lib/bindings/AutomationRun";
import type { UpdateAutomationInput } from "@/lib/bindings/UpdateAutomationInput";
import type { DeployAutomationInput, DeployAutomationResult } from "@/api/agents/automations";
import * as api from "@/api/agents/automations";

export interface AutomationSlice {
  // State
  automations: PersonaAutomation[];

  // Actions
  fetchAutomations: (personaId: string) => Promise<void>;
  /**
   * Update an automation. Pass ONLY the fields being changed — omission means
   * "leave alone", `null` on a `double_option` field means CLEAR. `Partial<>` is
   * what makes "leave alone" expressible at all; the generated
   * `UpdateAutomationInput` marks every field required, which previously forced
   * callers to pass `null` for all sixteen and silently erased data.
   * See docs/concepts/golden-paths/partial-update-semantics.md.
   */
  updateAutomation: (id: string, input: Partial<UpdateAutomationInput>) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
  testAutomation: (id: string) => Promise<AutomationRun | null>;
  deployAutomation: (input: DeployAutomationInput) => Promise<DeployAutomationResult | null>;
}

export const createAutomationSlice: StateCreator<VaultStore, [], [], AutomationSlice> = (set, get) => ({
  automations: [],

  fetchAutomations: async (personaId) => {
    try {
      const automations = await api.listAutomations(personaId);
      set({ automations });
    } catch (err) {
      reportError(err, "Failed to load automations", set);
    }
  },

  updateAutomation: async (id, input) => {
    try {
      const updated = await api.updateAutomation(id, input);
      set((state) => ({
        automations: state.automations.map((a) => (a.id === id ? updated : a)),
      }));
    } catch (err) {
      reportError(err, "Failed to update automation", set);
    }
  },

  deleteAutomation: async (id) => {
    const itemToDelete = get().automations.find((a) => a.id === id);
    if (!itemToDelete) return;

    set((state) => ({ automations: state.automations.filter((a) => a.id !== id) }));
    try {
      await api.deleteAutomation(id);
    } catch (err) {
      // Re-fetch from backend instead of appending stale item to avoid
      // duplicates if a concurrent fetch already restored the list.
      const personaId = itemToDelete.personaId;
      if (personaId) {
        await get().fetchAutomations(personaId);
      } else {
        // No personaId to scope a re-fetch by — reconcile state directly by
        // restoring the optimistically-removed item so the UI doesn't
        // silently diverge from the (still-existing) backend row.
        set((state) => (state.automations.some((a) => a.id === id)
          ? state
          : { automations: [...state.automations, itemToDelete] }));
      }
      reportError(err, "Failed to delete automation", set);
    }
  },

  testAutomation: async (id) => {
    try {
      const automation = get().automations.find((a) => a.id === id);
      return await api.testAutomationWebhook(id, automation);
    } catch (err) {
      reportError(err, "Automation test failed", set);
      return null;
    }
  },

  deployAutomation: async (input) => {
    try {
      const result = await api.deployAutomation(input);
      set((state) => ({ automations: [...state.automations, result.automation] }));
      return result;
    } catch (err) {
      reportError(err, "Failed to deploy automation", set);
      return null;
    }
  },
});
