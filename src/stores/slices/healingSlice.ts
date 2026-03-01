import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import * as api from "@/api/tauriApi";
import { errMsg } from "../storeTypes";

export interface HealingSlice {
  // State
  healingIssues: PersonaHealingIssue[];
  healingRunning: boolean;
  retryChain: PersonaExecution[];

  // Actions
  fetchHealingIssues: () => Promise<void>;
  triggerHealing: (personaId?: string) => Promise<{ failures_analyzed: number; issues_created: number; auto_fixed: number } | null>;
  resolveHealingIssue: (id: string, personaId?: string) => Promise<void>;
  fetchRetryChain: (executionId: string, personaId?: string) => Promise<void>;
}

export const createHealingSlice: StateCreator<PersonaStore, [], [], HealingSlice> = (set, get) => ({
  healingIssues: [],
  healingRunning: false,
  retryChain: [],

  fetchHealingIssues: async () => {
    try {
      const issues = await api.listHealingIssues();
      set({ healingIssues: issues });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch healing issues") });
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
    } catch (err) {
      set({ healingRunning: false, error: errMsg(err, "Failed to run healing analysis") });
      return null;
    }
  },

  resolveHealingIssue: async (id: string, personaId?: string) => {
    try {
      // Derive persona_id from loaded issues or fall back to the provided value
      const callerPersonaId = personaId
        ?? get().healingIssues.find((i) => i.id === id)?.persona_id
        ?? '';
      await api.updateHealingStatus(id, "resolved", callerPersonaId);
      set({ healingIssues: get().healingIssues.filter((i) => i.id !== id) });
    } catch (err) {
      set({ error: errMsg(err, "Failed to resolve healing issue") });
    }
  },

  fetchRetryChain: async (executionId: string, personaId?: string) => {
    try {
      const callerPersonaId = personaId ?? get().selectedPersona?.id ?? '';
      const chain = await api.getRetryChain(executionId, callerPersonaId);
      set({ retryChain: chain });
    } catch (err) {
      set({ retryChain: [], error: errMsg(err, "Failed to fetch retry chain") });
    }
  },
});
