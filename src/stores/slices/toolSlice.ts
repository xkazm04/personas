import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type {
  DbPersonaToolDefinition,
  ToolUsageSummary,
  ToolUsageOverTime,
  PersonaUsageSummary,
} from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface ToolSlice {
  // State
  toolDefinitions: DbPersonaToolDefinition[];
  toolUsageSummary: ToolUsageSummary[];
  toolUsageOverTime: ToolUsageOverTime[];
  toolUsageByPersona: PersonaUsageSummary[];

  // Actions
  fetchToolDefinitions: () => Promise<void>;
  assignTool: (personaId: string, toolId: string) => Promise<void>;
  removeTool: (personaId: string, toolId: string) => Promise<void>;
  fetchToolUsage: (days?: number, personaId?: string) => Promise<void>;
}

export const createToolSlice: StateCreator<PersonaStore, [], [], ToolSlice> = (set, get) => ({
  toolDefinitions: [],
  toolUsageSummary: [],
  toolUsageOverTime: [],
  toolUsageByPersona: [],

  fetchToolDefinitions: async () => {
    try {
      const toolDefinitions = await api.listToolDefinitions();
      set({ toolDefinitions });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch tools") });
    }
  },

  assignTool: async (personaId, toolId) => {
    try {
      await api.assignTool(personaId, toolId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to assign tool") });
    }
  },

  removeTool: async (personaId, toolId) => {
    try {
      await api.unassignTool(personaId, toolId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to remove tool") });
    }
  },

  fetchToolUsage: async (days = 30, personaId?: string) => {
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const [summary, overTime, byPersona] = await Promise.all([
        api.getToolUsageSummary(since, personaId),
        api.getToolUsageOverTime(since, personaId),
        api.getToolUsageByPersona(since),
      ]);
      set({
        toolUsageSummary: summary,
        toolUsageOverTime: overTime,
        toolUsageByPersona: byPersona,
      });
    } catch {
      set({ toolUsageSummary: [], toolUsageOverTime: [], toolUsageByPersona: [] });
    }
  },
});
