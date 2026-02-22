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
}

export const createEventSlice: StateCreator<PersonaStore, [], [], EventSlice> = (set) => ({
  recentEvents: [],
  pendingEventCount: 0,

  fetchRecentEvents: async (limit?: number) => {
    try {
      const events = await api.listEvents(limit ?? 50);
      set({ recentEvents: events, pendingEventCount: events.filter((e) => e.status === "pending").length });
    } catch {
      // Silent fail
    }
  },
});
