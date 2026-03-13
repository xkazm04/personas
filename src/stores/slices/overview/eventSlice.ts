import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { PersonaEvent } from "@/lib/types/types";
import { listEvents } from "@/api/overview/events";


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

  fetchRecentEvents: async (limit?: number) => {
    try {
      const events = await listEvents(limit ?? 50);
      set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
    } catch (err) {
      console.warn("[eventSlice] fetchRecentEvents failed:", err);
    }
  },

  pushRecentEvent: (event, maxItems = 200) => {
    set((state) => {
      const isPending = event.status === "pending";
      const existingIndex = state.recentEvents.findIndex((existing) => existing.id === event.id);

      let nextEvents: PersonaEvent[];
      let pendingDelta = 0;

      if (existingIndex >= 0) {
        const oldEvent = state.recentEvents[existingIndex]!;
        const wasPending = oldEvent.status === "pending";
        // Track transition: pending->non-pending = -1, non-pending->pending = +1
        if (wasPending && !isPending) pendingDelta = -1;
        else if (!wasPending && isPending) pendingDelta = 1;
        nextEvents = state.recentEvents.map((e, i) => i === existingIndex ? event : e);
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
