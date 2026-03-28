import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { HealingTimelineEvent } from "@/lib/bindings/HealingTimelineEvent";
import { getHealingIssue, getHealingTimeline, getRetryChain, listHealingIssues, runHealingAnalysis, updateHealingStatus } from "@/api/overview/healing";
import { typedListen } from "@/lib/eventRegistry";
import { EventName } from "@/lib/eventRegistry";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { reportError } from "../../storeTypes";

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
  subscribeHealingEvents: () => Promise<UnlistenFn>;
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
      reportError(err, "Failed to fetch healing issues", set);
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
      reportError(err, "Failed to run healing analysis", set, { stateUpdates: { healingRunning: false } });
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
      reportError(err, "Failed to resolve healing issue", set);
    }
  },

  fetchRetryChain: async (executionId: string, personaId?: string) => {
    try {
      const callerPersonaId = personaId ?? storeBus.get<string | undefined>(AccessorKey.AGENTS_SELECTED_PERSONA_ID) ?? '';
      const chain = await getRetryChain(executionId, callerPersonaId);
      set({ retryChain: chain });
    } catch (err) {
      reportError(err, "Failed to fetch retry chain", set, { stateUpdates: { retryChain: [] } });
    }
  },

  fetchHealingTimeline: async (personaId: string) => {
    set({ healingTimelineLoading: true });
    try {
      const timeline = await getHealingTimeline(personaId);
      set({ healingTimeline: timeline, healingTimelineLoading: false });
    } catch (err) {
      reportError(err, "Failed to fetch healing timeline", set, { stateUpdates: { healingTimeline: [], healingTimelineLoading: false } });
    }
  },

  subscribeHealingEvents: async () => {
    const unlisten = await typedListen(EventName.HEALING_ISSUE_UPDATED, async (payload) => {
      const { issueId, personaId } = payload;

      // Selectively re-fetch just the affected issue
      try {
        const updated = await getHealingIssue(issueId, personaId);
        set((state) => ({
          healingIssues: state.healingIssues.map((i) =>
            i.id === issueId ? updated : i,
          ),
        }));
      } catch {
        // Issue may have been deleted or is no longer accessible — remove it
        set((state) => ({
          healingIssues: state.healingIssues.filter((i) => i.id !== issueId),
        }));
      }
    });
    return unlisten;
  },
});
