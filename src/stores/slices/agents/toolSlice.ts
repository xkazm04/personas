import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type {
  PersonaToolDefinition,
  ToolUsageSummary,
  ToolUsageOverTime,
  PersonaUsageSummary,
} from "@/lib/types/types";
import { assignTool, bulkAssignTools, bulkUnassignTools, getToolUsageByPersona, getToolUsageOverTime, getToolUsageSummary, listToolDefinitions, unassignTool } from "@/api/agents/tools";


export interface ToolSlice {
  // State
  toolDefinitions: PersonaToolDefinition[];
  toolUsageSummary: ToolUsageSummary[];
  toolUsageOverTime: ToolUsageOverTime[];
  toolUsageByPersona: PersonaUsageSummary[];

  // Actions
  fetchToolDefinitions: () => Promise<void>;
  assignTool: (personaId: string, toolId: string) => Promise<void>;
  removeTool: (personaId: string, toolId: string) => Promise<void>;
  bulkAssignTools: (personaId: string, toolIds: string[]) => Promise<void>;
  bulkRemoveTools: (personaId: string, toolIds: string[]) => Promise<void>;
  fetchToolUsage: (days?: number, personaId?: string) => Promise<void>;
}

export const createToolSlice: StateCreator<AgentStore, [], [], ToolSlice> = (set, get) => ({
  toolDefinitions: [],
  toolUsageSummary: [],
  toolUsageOverTime: [],
  toolUsageByPersona: [],

  fetchToolDefinitions: async () => {
    try {
      const toolDefinitions = await listToolDefinitions();
      set({ toolDefinitions });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch tools") });
      throw err;
    }
  },

  assignTool: async (personaId, toolId) => {
    try {
      await assignTool(personaId, toolId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to assign tool") });
    }
  },

  removeTool: async (personaId, toolId) => {
    try {
      await unassignTool(personaId, toolId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ error: errMsg(err, "Failed to remove tool") });
    }
  },

  bulkAssignTools: async (personaId, toolIds) => {
    try {
      await bulkAssignTools(personaId, toolIds);
    } catch (err) {
      set({ error: errMsg(err, "Failed to assign tools") });
    } finally {
      get().fetchDetail(personaId);
    }
  },

  bulkRemoveTools: async (personaId, toolIds) => {
    try {
      await bulkUnassignTools(personaId, toolIds);
    } catch (err) {
      set({ error: errMsg(err, "Failed to remove tools") });
    } finally {
      get().fetchDetail(personaId);
    }
  },

  fetchToolUsage: async (days = 30, personaId?: string) => {
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const [summary, overTime, byPersona] = await Promise.all([
        getToolUsageSummary(since, personaId),
        getToolUsageOverTime(since, personaId),
        getToolUsageByPersona(since),
      ]);
      set({
        toolUsageSummary: summary,
        toolUsageOverTime: overTime,
        toolUsageByPersona: byPersona,
      });
    } catch {
      // intentional: error state handled by store -- resets to empty arrays for graceful degradation
      set({ toolUsageSummary: [], toolUsageOverTime: [], toolUsageByPersona: [] });
    }
  },
});
