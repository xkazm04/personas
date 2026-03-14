import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { CronAgent } from "@/lib/bindings/CronAgent";
import { listCronAgents } from "@/api/pipeline/triggers";

import { reportError } from "../../storeTypes";

export interface CronAgentsSlice {
  cronAgents: CronAgent[];
  cronAgentsLoading: boolean;
  fetchCronAgents: () => Promise<void>;
}

export const createCronAgentsSlice: StateCreator<OverviewStore, [], [], CronAgentsSlice> = (set) => ({
  cronAgents: [],
  cronAgentsLoading: false,

  fetchCronAgents: async () => {
    set({ cronAgentsLoading: true });
    try {
      const agents = await listCronAgents();
      set({ cronAgents: agents, cronAgentsLoading: false });
    } catch (err) {
      reportError(err, "Failed to load scheduled agents", set, { stateUpdates: { cronAgentsLoading: false } });
    }
  },
});
