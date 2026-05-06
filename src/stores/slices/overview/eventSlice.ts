import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { PersonaEvent } from "@/lib/types/types";
import { listEvents } from "@/api/overview/events";
import { deduplicateKeyedFetch } from "@/lib/utils/deduplicateFetch";
import { createLogger } from "@/lib/log";

const logger = createLogger("events");


export interface EventSlice {
  // State
  recentEvents: PersonaEvent[];
  pendingEventCount: number;

  // Actions
  fetchRecentEvents: (limit?: number) => Promise<void>;
  pushRecentEvent: (event: PersonaEvent, maxItems?: number) => void;
}

export const createEventSlice: StateCreator<OverviewStore, [], [], EventSlice> = (set) => ({
  recentEvents: [],
  pendingEventCount: 0,

  fetchRecentEvents: deduplicateKeyedFetch('recentEvents', async (limit?: number) => {
    try {
      const events = await listEvents(limit ?? 50);
      set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
    } catch (err) {
      logger.warn("fetchRecentEvents failed", { error: String(err) });
    }
  }),

  pushRecentEvent: (event, maxItems = 200) => {
    set((state) => {
      const isPending = event.status === "pending";
      // O(n) scan over recentEvents — bounded by maxItems (200), and lookup
      // stays in sync with the array because both live in the same state.
      // A module-scoped index would survive store recreation (HMR, multi-window,
      // test isolation) while recentEvents resets, causing pendingEventCount to drift.
      const oldIndex = state.recentEvents.findIndex((e) => e.id === event.id);
      const oldEvent = oldIndex >= 0 ? state.recentEvents[oldIndex] : undefined;

      let nextEvents: PersonaEvent[];
      let pendingDelta = 0;

      if (oldEvent) {
        const wasPending = oldEvent.status === "pending";
        if (wasPending && !isPending) pendingDelta = -1;
        else if (!wasPending && isPending) pendingDelta = 1;
        nextEvents = state.recentEvents.map((e) => e.id === event.id ? event : e);
      } else {
        nextEvents = [event, ...state.recentEvents];
        if (isPending) pendingDelta = 1;
      }

      // Account for any pending event that gets trimmed off the end
      if (nextEvents.length > maxItems) {
        const dropped = nextEvents[maxItems]!;
        if (dropped.status === "pending") pendingDelta -= 1;
        nextEvents = nextEvents.slice(0, maxItems);
      }

      return {
        recentEvents: nextEvents,
        pendingEventCount: Math.max(0, state.pendingEventCount + pendingDelta),
      };
    });
  },
});
