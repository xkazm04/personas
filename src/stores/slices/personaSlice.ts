import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  DbPersona,
  PersonaWithDetails,
} from "@/lib/types/types";
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
  createPersona: (input: { name: string; description?: string; system_prompt: string; icon?: string; color?: string }) => Promise<DbPersona>;
  updatePersona: (id: string, input: Record<string, unknown>) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  selectPersona: (id: string | null) => void;
}

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
    const { personas } = get();
    const results = await Promise.all(
      personas.map(async (p) => {
        try {
          const [triggers, execs] = await Promise.all([
            api.listTriggers(p.id),
            api.listExecutions(p.id, 5),
          ]);
          const enabledCount = triggers.filter((t) => t.enabled).length;
          const lastRun = execs[0]?.created_at ?? null;
          const healthStatuses = execs.map((e) => e.status);
          return { id: p.id, triggerCount: enabledCount, lastRun, healthStatuses };
        } catch {
          return { id: p.id, triggerCount: 0, lastRun: null, healthStatuses: [] as string[] };
        }
      }),
    );
    const triggerCounts: Record<string, number> = {};
    const lastRun: Record<string, string | null> = {};
    const healthMap: Record<string, string[]> = {};
    for (const r of results) {
      triggerCounts[r.id] = r.triggerCount;
      lastRun[r.id] = r.lastRun;
      healthMap[r.id] = r.healthStatuses;
    }
    set({ personaTriggerCounts: triggerCounts, personaLastRun: lastRun, personaHealthMap: healthMap });
  },

  fetchDetail: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const persona = await api.getPersona(id);
      // Assemble PersonaWithDetails from multiple IPC calls
      const [allTools, triggers, subscriptions] = await Promise.all([
        api.listToolDefinitions(),
        api.listTriggers(id),
        api.listSubscriptions(id),
      ]);
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
        structured_prompt: null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        enabled: null,
        max_concurrent: null,
        timeout_ms: null,
        model_profile: null,
        max_budget_usd: null,
        max_turns: null,
        design_context: null,
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
      // Build update input with correct skip vs set-to-null semantics.
      // - Option<T> fields (name, system_prompt, etc.): null = skip, value = set
      // - Option<Option<T>> fields (description, icon, etc.): key absent = skip, null = clear, value = set
      const updateInput: Record<string, unknown> = {
        name: (input.name as string) ?? null,
        system_prompt: (input.system_prompt as string) ?? null,
        enabled: input.enabled !== undefined ? (input.enabled as boolean) : null,
        max_concurrent: (input.max_concurrent as number) ?? null,
        timeout_ms: (input.timeout_ms as number) ?? null,
        notification_channels: (input.notification_channels as string) ?? null,
      };
      // Double-option fields: only include when explicitly provided to distinguish
      // "skip" (key absent) from "set to null" (key present with null value).
      if (input.description !== undefined) updateInput.description = input.description as string | null;
      if (input.structured_prompt !== undefined) updateInput.structured_prompt = input.structured_prompt as string | null;
      if (input.icon !== undefined) updateInput.icon = input.icon as string | null;
      if (input.color !== undefined) updateInput.color = input.color as string | null;
      if (input.last_design_result !== undefined) updateInput.last_design_result = input.last_design_result as string | null;
      if (input.model_profile !== undefined) updateInput.model_profile = input.model_profile as string | null;
      if (input.max_budget_usd !== undefined) updateInput.max_budget_usd = input.max_budget_usd as number | null;
      if (input.max_turns !== undefined) updateInput.max_turns = input.max_turns as number | null;
      if (input.design_context !== undefined) updateInput.design_context = input.design_context as string | null;
      if (input.group_id !== undefined) updateInput.group_id = input.group_id as string | null;
      const persona = await api.updatePersona(id, updateInput as import("@/lib/bindings/UpdatePersonaInput").UpdatePersonaInput);
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
    set({ selectedPersonaId: id, editorTab: "prompt", sidebarSection: id ? "personas" : get().sidebarSection });
    if (id) get().fetchDetail(id);
    else set({ selectedPersona: null });
  },
});
