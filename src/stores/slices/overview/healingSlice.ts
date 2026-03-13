import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { useAgentStore } from "../../agentStore";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { HealingTimelineEvent } from "@/lib/bindings/HealingTimelineEvent";
import { getHealingTimeline, getRetryChain, listHealingIssues, runHealingAnalysis, updateHealingStatus } from "@/api/overview/healing";

import { errMsg } from "../../storeTypes";

export interface HealingSlice {
  // State
  healingIssues: PersonaHealingIssue[];
  healingRunning: boolean;
  retryChain: PersonaExecution[];
  healingTimeline: HealingTimelineEvent[];
  healingTimelineLoading: boolean;

  // Actions
  fetchHealingIssues: () => Promise<void>;
  triggerHealing: (personaId?: string) => Promise<{ failures_analyzed: number; issues_created: number; auto_fixed: number } | null>;
  resolveHealingIssue: (id: string, personaId?: string) => Promise<void>;
  fetchRetryChain: (executionId: string, personaId?: string) => Promise<void>;
  fetchHealingTimeline: (personaId: string) => Promise<void>;
}

export const createHealingSlice: StateCreator<OverviewStore, [], [], HealingSlice> = (set, get) => ({
  healingIssues: [],
  healingRunning: false,
  retryChain: [],
  healingTimeline: [],
  healingTimelineLoading: false,

  fetchHealingIssues: async () => {
    try {
      const issues = await listHealingIssues();
      set({ healingIssues: issues });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch healing issues") });
    }
  },

  triggerHealing: async (personaId?: string) => {
    if (!personaId) return null;
    set({ healingRunning: true });
    try {
      const result = await runHealingAnalysis(personaId);
      const issues = await listHealingIssues();
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
      await updateHealingStatus(id, "resolved", callerPersonaId);
      set((state) => ({ healingIssues: state.healingIssues.filter((i) => i.id !== id) }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to resolve healing issue") });
    }
  },

  fetchRetryChain: async (executionId: string, personaId?: string) => {
    try {
      const callerPersonaId = personaId ?? useAgentStore.getState().selectedPersona?.id ?? '';
      const chain = await getRetryChain(executionId, callerPersonaId);
      set({ retryChain: chain });
    } catch (err) {
      set({ retryChain: [], error: errMsg(err, "Failed to fetch retry chain") });
    }
  },

  fetchHealingTimeline: async (personaId: string) => {
    set({ healingTimelineLoading: true });
    try {
      const timeline = await getHealingTimeline(personaId);
      set({ healingTimeline: timeline, healingTimelineLoading: false });
    } catch (err) {
      set({ healingTimeline: [], healingTimelineLoading: false, error: errMsg(err, "Failed to fetch healing timeline") });
    }
  },
});
