import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type {
  PersonaToolDefinition,
  ToolUsageSummary,
  ToolUsageOverTime,
  PersonaUsageSummary,
} from "@/lib/types/types";
import { assignTool, bulkAssignTools, bulkUnassignTools, getToolUsageByPersona, getToolUsageOverTime, getToolUsageSummary, listToolDefinitions, unassignTool } from "@/api/agents/tools";

const TOOL_DEFS_TTL_MS = 60_000; // 60 seconds

export interface ToolSlice {
  // State
  toolDefinitions: PersonaToolDefinition[];
  toolUsageSummary: ToolUsageSummary[];
  toolUsageOverTime: ToolUsageOverTime[];
  toolUsageByPersona: PersonaUsageSummary[];
  /** @internal Timestamp of last successful tool definitions fetch */
  _toolDefsCachedAt: number;

  // Actions
  fetchToolDefinitions: () => Promise<void>;
  /** Returns cached tool definitions if fresh (<60s), otherwise fetches. */
  getToolDefinitions: () => Promise<PersonaToolDefinition[]>;
  /** Marks the tool definitions cache as stale so the next read re-fetches. */
  invalidateToolDefCache: () => void;
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
  _toolDefsCachedAt: 0,

  fetchToolDefinitions: async () => {
    try {
      const toolDefinitions = await listToolDefinitions();
      set({ toolDefinitions, _toolDefsCachedAt: Date.now() });
    } catch (err) {
      reportError(err, "Failed to fetch tools", set);
      throw err;
    }
  },

  getToolDefinitions: async () => {
    const { toolDefinitions, _toolDefsCachedAt } = get();
    if (toolDefinitions.length > 0 && Date.now() - _toolDefsCachedAt < TOOL_DEFS_TTL_MS) {
      return toolDefinitions;
    }
    await get().fetchToolDefinitions();
    return get().toolDefinitions;
  },

  invalidateToolDefCache: () => {
    set({ _toolDefsCachedAt: 0 });
  },

  assignTool: async (personaId, toolId) => {
    try {
      await assignTool(personaId, toolId);
      get().invalidateToolDefCache();
      get().fetchDetail(personaId).catch(() => {});
    } catch (err) {
      reportError(err, "Failed to assign tool", set);
    }
  },

  removeTool: async (personaId, toolId) => {
    try {
      await unassignTool(personaId, toolId);
      get().invalidateToolDefCache();
      get().fetchDetail(personaId).catch(() => {});
    } catch (err) {
      reportError(err, "Failed to remove tool", set);
    }
  },

  bulkAssignTools: async (personaId, toolIds) => {
    try {
      await bulkAssignTools(personaId, toolIds);
    } catch (err) {
      reportError(err, "Failed to assign tools", set);
    } finally {
      get().invalidateToolDefCache();
      get().fetchDetail(personaId).catch(() => {});
    }
  },

  bulkRemoveTools: async (personaId, toolIds) => {
    try {
      await bulkUnassignTools(personaId, toolIds);
    } catch (err) {
      reportError(err, "Failed to remove tools", set);
    } finally {
      get().invalidateToolDefCache();
      get().fetchDetail(personaId).catch(() => {});
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
    } catch (err) {
      console.warn("[toolSlice] fetchToolUsage failed:", err);
      reportError(err, "Failed to load tool usage", set, { stateUpdates: { toolUsageSummary: [], toolUsageOverTime: [], toolUsageByPersona: [] } });
    }
  },
});
