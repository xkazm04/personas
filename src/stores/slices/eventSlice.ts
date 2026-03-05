import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { PersonaEvent } from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface EventSlice {
  // State
  recentEvents: PersonaEvent[];
  pendingEventCount: number;

  // Actions
  fetchRecentEvents: (limit?: number) => Promise<void>;
  pushRecentEvent: (event: PersonaEvent, maxItems?: number) => void;
}

export const createEventSlice: StateCreator<PersonaStore, [], [], EventSlice> = (set) => ({
  recentEvents: [],
  pendingEventCount: 0,

  fetchRecentEvents: async (limit?: number) => {
    try {
      const events = await api.listEvents(limit ?? 50);
      set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
    } catch (err) {
      console.warn("[eventSlice] fetchRecentEvents failed:", err);
    }
  },

  pushRecentEvent: (event, maxItems = 200) => {
    set((state) => {
      const existingIndex = state.recentEvents.findIndex((existing) => existing.id === event.id);

      let nextEvents: PersonaEvent[];
      if (existingIndex >= 0) {
        // Replace in place so status transitions (pending -> completed/failed) are reflected.
        nextEvents = [...state.recentEvents];
        nextEvents[existingIndex] = event;
      } else {
        nextEvents = [event, ...state.recentEvents];
      }

      const trimmed = nextEvents.length > maxItems ? nextEvents.slice(0, maxItems) : nextEvents;
      const nextPendingCount = trimmed.filter((e) => e.status === "pending").length;

      return {
        recentEvents: trimmed,
        pendingEventCount: nextPendingCount,
      };
    });
  },
});
