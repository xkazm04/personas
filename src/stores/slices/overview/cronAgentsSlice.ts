import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { CronAgent } from "@/lib/bindings/CronAgent";
import { listCronAgents } from "@/api/pipeline/triggers";

import { reportError } from "../../storeTypes";
import { silentCatch } from "@/lib/silentCatch";
import { createLatestWins } from "../../util/latestWins";

export interface CronAgentsSlice {
  cronAgents: CronAgent[];
  cronAgentsLoading: boolean;
  /**
   * `quiet`: a background refresh (the Persona Monitor's next-start read, every
   * 30 s) logs a failure instead of toasting it, so a failing read cannot toast
   * twice a minute behind the operator's back.
   */
  fetchCronAgents: (opts?: { quiet?: boolean }) => Promise<void>;
}

export const createCronAgentsSlice: StateCreator<OverviewStore, [], [], CronAgentsSlice> = (set) => {
  // Only the latest in-flight `fetchCronAgents` call is allowed to write its
  // result to state — see createLatestWins() for why. Same shape as
  // `memorySlice.fetchMemories`.
  const latestWins = createLatestWins();

  return {
    cronAgents: [],
    cronAgentsLoading: false,

    fetchCronAgents: async (opts) => {
      const token = latestWins.next();
      set({ cronAgentsLoading: true });
      try {
        const agents = await listCronAgents();
        // Discard stale responses — a newer fetch is already in-flight.
        if (!latestWins.isCurrent(token)) return;
        set({ cronAgents: agents, cronAgentsLoading: false });
      } catch (err) {
        if (!latestWins.isCurrent(token)) return;
        if (opts?.quiet) {
          set({ cronAgentsLoading: false });
          silentCatch("overview/fetchCronAgents:quiet")(err);
          return;
        }
        reportError(err, "Failed to load scheduled agents", set, { stateUpdates: { cronAgentsLoading: false } });
      }
    },
  };
};
