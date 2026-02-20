import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import * as api from "@/api/tauriApi";

export interface HealingSlice {
  // State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  healingIssues: any[];
  healingRunning: boolean;

  // Actions
  fetchHealingIssues: () => Promise<void>;
  triggerHealing: (personaId?: string) => Promise<{ failures_analyzed: number; issues_created: number; auto_fixed: number } | null>;
  resolveHealingIssue: (id: string) => Promise<void>;
}

export const createHealingSlice: StateCreator<PersonaStore, [], [], HealingSlice> = (set, get) => ({
  healingIssues: [],
  healingRunning: false,

  fetchHealingIssues: async () => {
    try {
      const issues = await api.listHealingIssues();
      set({ healingIssues: issues });
    } catch {
      // Silent fail
    }
  },

  triggerHealing: async (personaId?: string) => {
    if (!personaId) return null;
    set({ healingRunning: true });
    try {
      const result = await api.runHealingAnalysis(personaId);
      const issues = await api.listHealingIssues(personaId);
      set({ healingIssues: issues, healingRunning: false });
      return { failures_analyzed: result.failures_analyzed, issues_created: result.issues_created, auto_fixed: result.auto_fixed };
    } catch {
      set({ healingRunning: false });
      return null;
    }
  },

  resolveHealingIssue: async (id: string) => {
    try {
      await api.updateHealingStatus(id, "resolved");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set({ healingIssues: get().healingIssues.filter((i: any) => i.id !== id) });
    } catch {
      // Silent fail
    }
  },
});
