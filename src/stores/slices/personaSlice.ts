import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  DbPersona,
  PersonaWithDetails,
} from "@/lib/types/types";
import type { PartialPersonaUpdate } from "@/api/personas";
import { buildUpdateInput } from "@/api/personas";
import * as api from "@/api/tauriApi";

export interface PersonaSlice {
  // State
  personas: DbPersona[];
  selectedPersonaId: string | null;
  selectedPersona: PersonaWithDetails | null;
  personaTriggerCounts: Record<string, number>;
  personaLastRun: Record<string, string | null>;
  personaHealthMap: Record<string, string[]>;

  // Actions
  fetchPersonas: () => Promise<void>;
  fetchPersonaSummaries: () => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
  createPersona: (input: { name: string; description?: string; system_prompt: string; icon?: string; color?: string; structured_prompt?: string; design_context?: string }) => Promise<DbPersona>;
  updatePersona: (id: string, input: PartialPersonaUpdate) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  selectPersona: (id: string | null) => void;
}

let fetchDetailSeq = 0;

export const createPersonaSlice: StateCreator<PersonaStore, [], [], PersonaSlice> = (set, get) => ({
  personas: [],
  selectedPersonaId: null,
  selectedPersona: null,
  personaTriggerCounts: {},
  personaLastRun: {},
  personaHealthMap: {},

  fetchPersonas: async () => {
    set({ isLoading: true, error: null });
    try {
      const personas = await api.listPersonas();
      set({ personas, isLoading: false });
      // Fire-and-forget: load sidebar badge data
      get().fetchPersonaSummaries();
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch personas"), isLoading: false });
    }
  },

  fetchPersonaSummaries: async () => {
    try {
      const summaries = await api.getPersonaSummaries();
      const triggerCounts: Record<string, number> = {};
      const lastRun: Record<string, string | null> = {};
      const healthMap: Record<string, string[]> = {};
      for (const s of summaries) {
        triggerCounts[s.persona_id] = s.enabled_trigger_count;
        lastRun[s.persona_id] = s.last_run_at;
        if ('health_statuses' in s && Array.isArray(s.health_statuses)) {
          healthMap[s.persona_id] = s.health_statuses;
        }
      }
      set({ personaTriggerCounts: triggerCounts, personaLastRun: lastRun, personaHealthMap: healthMap });
    } catch {
      // Summaries are non-critical sidebar badges — silently ignore errors
    }
  },

  fetchDetail: async (id: string) => {
    const seq = ++fetchDetailSeq;
    set({ isLoading: true, error: null });
    try {
      const persona = await api.getPersona(id);
      if (seq !== fetchDetailSeq) return; // superseded by a newer request
      // Assemble PersonaWithDetails from multiple IPC calls
      const [allTools, triggers, subscriptions] = await Promise.all([
        api.listToolDefinitions(),
        api.listTriggers(id),
        api.listSubscriptions(id),
      ]);
      if (seq !== fetchDetailSeq) return; // superseded by a newer request
      // Find tools assigned to this persona (cross-reference with persona_tools)
      // For now, use all tool definitions — actual assignment filtering can be refined
      const detail: PersonaWithDetails = {
        ...persona,
        tools: allTools,
        triggers,
        subscriptions,
      };
      set({ selectedPersona: detail, selectedPersonaId: id, isLoading: false });
    } catch (err) {
      if (seq !== fetchDetailSeq) return; // superseded by a newer request
      set({ error: errMsg(err, "Failed to fetch persona"), isLoading: false });
    }
  },

  createPersona: async (input) => {
    set({ error: null });
    try {
      const persona = await api.createPersona({
        name: input.name,
        system_prompt: input.system_prompt,
        project_id: null,
        description: input.description ?? null,
        structured_prompt: input.structured_prompt ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        enabled: null,
        max_concurrent: null,
        timeout_ms: null,
        model_profile: null,
        max_budget_usd: null,
        max_turns: null,
        design_context: input.design_context ?? null,
        group_id: null,
      });
      set((state) => ({ personas: [persona, ...state.personas] }));
      return persona;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create persona") });
      throw err;
    }
  },

  updatePersona: async (id, input) => {
    set({ error: null });
    try {
      const persona = await api.updatePersona(id, buildUpdateInput(input));
      set((state) => ({
        personas: state.personas.map((p) => (p.id === id ? persona : p)),
        selectedPersona:
          state.selectedPersona?.id === id
            ? { ...state.selectedPersona, ...persona }
            : state.selectedPersona,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update persona") });
    }
  },

  deletePersona: async (id) => {
    set({ error: null });
    try {
      await api.deletePersona(id);
      set((state) => ({
        personas: state.personas.filter((p) => p.id !== id),
        selectedPersonaId: state.selectedPersonaId === id ? null : state.selectedPersonaId,
        selectedPersona: state.selectedPersona?.id === id ? null : state.selectedPersona,
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete persona") });
    }
  },

  selectPersona: (id) => {
    set({ selectedPersonaId: id, editorTab: "use-cases", sidebarSection: id ? "personas" : get().sidebarSection, isCreatingPersona: false });
    if (id) get().fetchDetail(id);
    else set({ selectedPersona: null });
  },
});
