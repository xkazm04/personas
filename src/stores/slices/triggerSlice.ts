import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import * as api from "@/api/tauriApi";

export interface TriggerSlice {
  // Actions only (no owned state)
  createTrigger: (personaId: string, input: { trigger_type: string; config?: object; enabled?: boolean }) => Promise<void>;
  updateTrigger: (personaId: string, triggerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteTrigger: (personaId: string, triggerId: string) => Promise<void>;
}

export const createTriggerSlice: StateCreator<PersonaStore, [], [], TriggerSlice> = (set, get) => ({
  createTrigger: async (personaId, input) => {
    try {
      await api.createTrigger({
        persona_id: personaId,
        trigger_type: input.trigger_type,
        config: input.config ? JSON.stringify(input.config) : null,
        enabled: input.enabled ?? null,
      });
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to create trigger") });
    }
  },

  updateTrigger: async (personaId, triggerId, updates) => {
    try {
      await api.updateTrigger(triggerId, {
        trigger_type: (updates.trigger_type as string) ?? null,
        config: updates.config ? JSON.stringify(updates.config) : null,
        enabled: updates.enabled !== undefined ? (updates.enabled as boolean) : null,
        next_trigger_at: null,
      });
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to update trigger") });
    }
  },

  deleteTrigger: async (personaId, triggerId) => {
    try {
      await api.deleteTrigger(triggerId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete trigger") });
    }
  },
});
