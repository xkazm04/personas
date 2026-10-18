import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("tool");
import type {
  PersonaToolDefinition,
  ToolUsageSummary,
  ToolUsageOverTime,
  PersonaUsageSummary,
} from "@/lib/types/types";
import { getToolUsageByPersona, getToolUsageOverTime, getToolUsageSummary, listToolDefinitions } from "@/api/agents/tools";

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
      logger.warn("fetchToolUsage failed", { error: String(err) });
      reportError(err, "Failed to load tool usage", set, { stateUpdates: { toolUsageSummary: [], toolUsageOverTime: [], toolUsageByPersona: [] } });
    }
  },
});
