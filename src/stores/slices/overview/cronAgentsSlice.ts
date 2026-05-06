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

export const createCronAgentsSlice: StateCreator<OverviewStore, [], [], CronAgentsSlice> = (set) => {
  /**
   * Monotonic counter — only the latest in-flight `fetchCronAgents` call is
   * allowed to write its result to state. Without this gate, two concurrent
   * fetches (StrictMode double-mount in dev, route revisits, rapid filter
   * toggles, the auto-refresh racing a manual refresh) would race, and
   * whichever resolves LAST would win — even when its data was older,
   * producing flickering schedules and lagging "last-triggered" values on
   * the dashboard. Same shape as `memorySlice.fetchMemories`.
   */
  let fetchRequestId = 0;

  return {
    cronAgents: [],
    cronAgentsLoading: false,

    fetchCronAgents: async () => {
      const requestId = ++fetchRequestId;
      set({ cronAgentsLoading: true });
      try {
        const agents = await listCronAgents();
        // Discard stale responses — a newer fetch is already in-flight.
        if (requestId !== fetchRequestId) return;
        set({ cronAgents: agents, cronAgentsLoading: false });
      } catch (err) {
        if (requestId !== fetchRequestId) return;
        reportError(err, "Failed to load scheduled agents", set, { stateUpdates: { cronAgentsLoading: false } });
      }
    },
  };
};
