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

// O(1) lookup index for event dedup — kept in sync with recentEvents array
const eventIndex = new Map<string, PersonaEvent>();

export const createEventSlice: StateCreator<OverviewStore, [], [], EventSlice> = (set) => ({
  recentEvents: [],
  pendingEventCount: 0,

  fetchRecentEvents: deduplicateKeyedFetch('recentEvents', async (limit?: number) => {
    try {
      const events = await listEvents(limit ?? 50);
      eventIndex.clear();
      for (const e of events) eventIndex.set(e.id, e);
      set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
    } catch (err) {
      logger.warn("fetchRecentEvents failed", { error: String(err) });
    }
  }),

  pushRecentEvent: (event, maxItems = 200) => {
    set((state) => {
      const isPending = event.status === "pending";
      const oldEvent = eventIndex.get(event.id);

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

      eventIndex.set(event.id, event);

      // Account for any pending event that gets trimmed off the end
      if (nextEvents.length > maxItems) {
        const dropped = nextEvents[maxItems]!;
        eventIndex.delete(dropped.id);
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
