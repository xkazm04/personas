import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import type { CronAgent } from "@/lib/bindings/CronAgent";
import * as api from "@/api/tauriApi";
import { useToastStore } from "@/stores/toastStore";

export interface CronAgentsSlice {
  cronAgents: CronAgent[];
  cronAgentsLoading: boolean;
  fetchCronAgents: () => Promise<void>;
}

export const createCronAgentsSlice: StateCreator<PersonaStore, [], [], CronAgentsSlice> = (set) => ({
  cronAgents: [],
  cronAgentsLoading: false,

  fetchCronAgents: async () => {
    set({ cronAgentsLoading: true });
    try {
      const agents = await api.listCronAgents();
      set({ cronAgents: agents, cronAgentsLoading: false });
    } catch {
      set({ cronAgentsLoading: false });
      useToastStore.getState().addToast('Failed to load scheduled agents', 'error');
    }
  },
});
