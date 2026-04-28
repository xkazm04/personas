import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { AmbientContextSnapshot } from "@/lib/bindings/AmbientContextSnapshot";
import type { SensoryPolicy } from "@/lib/bindings/SensoryPolicy";
import type { ContextRule } from "@/lib/bindings/ContextRule";
import type { ContextRuleMatch } from "@/lib/bindings/ContextRuleMatch";
import type { ContextStreamStats } from "@/lib/bindings/ContextStreamStats";
import {
  getAmbientContextSnapshot,
  setAmbientContextEnabled,
  getAmbientContextEnabled,
  setAmbientSensoryPolicy,
  getAmbientSensoryPolicy,
  removeAmbientSensoryPolicy,
  addContextRule,
  removeContextRule,
  listContextRules,
  getContextRuleMatches,
  getContextStreamStats,
} from "@/api/system/ambientContext";
import { reportError } from "../../storeTypes";

export interface AmbientContextSlice {
  // State
  ambientSnapshot: AmbientContextSnapshot | null;
  ambientEnabled: boolean;
  ambientPolicy: SensoryPolicy | null;
  ambientLoading: boolean;
  ambientError: string | null;

  // Context Rules state
  contextRules: ContextRule[];
  contextRuleMatches: ContextRuleMatch[];
  contextStreamStats: ContextStreamStats | null;

  // Actions
  fetchAmbientSnapshot: (personaId: string) => Promise<void>;
  toggleAmbientEnabled: (enabled: boolean) => Promise<void>;
  fetchAmbientEnabled: () => Promise<void>;
  updateSensoryPolicy: (personaId: string, policy: SensoryPolicy) => Promise<void>;
  fetchSensoryPolicy: (personaId: string) => Promise<void>;
  resetSensoryPolicy: (personaId: string) => Promise<void>;

  // Context Rules actions
  fetchContextRules: (personaId: string) => Promise<void>;
  addContextRule: (rule: ContextRule) => Promise<void>;
  removeContextRule: (ruleId: string) => Promise<void>;
  fetchContextRuleMatches: () => Promise<void>;
  fetchContextStreamStats: () => Promise<void>;
}

export const DEFAULT_SENSORY_POLICY: SensoryPolicy = {
  clipboard: true,
  fileChanges: true,
  appFocus: true,
  focusAppFilter: [],
  fileGlobFilter: [],
  maxWindowSize: 30,
  maxAgeSecs: 600,
};

export const createAmbientContextSlice: StateCreator<SystemStore, [], [], AmbientContextSlice> = (set) => {
  // Tracks the most recently *requested* personaId for each per-persona fetch.
  // Each in-flight fetch captures its own personaId at start; on resolve, it
  // commits to the store only if it still matches the latest request. This
  // closes the race where a 5s interval-driven fetch for persona A resolves
  // after the user has switched to B, otherwise overwriting B's snapshot/policy/
  // rules with A's data.
  let latestSnapshotPersonaId: string | null = null;
  let latestPolicyPersonaId: string | null = null;
  let latestRulesPersonaId: string | null = null;

  return {
  ambientSnapshot: null,
  ambientEnabled: true,
  ambientPolicy: null,
  ambientLoading: false,
  ambientError: null,

  // Context Rules initial state
  contextRules: [],
  contextRuleMatches: [],
  contextStreamStats: null,

  fetchAmbientSnapshot: async (personaId: string) => {
    latestSnapshotPersonaId = personaId;
    try {
      const snapshot = await getAmbientContextSnapshot(personaId);
      if (latestSnapshotPersonaId !== personaId) return;
      set({ ambientSnapshot: snapshot, ambientEnabled: snapshot.enabled });
    } catch (err) {
      if (latestSnapshotPersonaId !== personaId) return;
      reportError(err, "Failed to fetch ambient context", set as (partial: { error: string }) => void, {
        severity: "state",
        stateUpdates: { ambientError: err instanceof Error ? err.message : String(err) },
      });
    }
  },

  toggleAmbientEnabled: async (enabled: boolean) => {
    try {
      const result = await setAmbientContextEnabled(enabled);
      set({ ambientEnabled: result });
    } catch (err) {
      reportError(err, "Failed to toggle ambient context", set as (partial: { error: string }) => void, {
        severity: "toast",
      });
    }
  },

  fetchAmbientEnabled: async () => {
    try {
      const enabled = await getAmbientContextEnabled();
      set({ ambientEnabled: enabled });
    } catch {
      // Silently fail — ambient context may not be available on non-desktop
    }
  },

  updateSensoryPolicy: async (personaId: string, policy: SensoryPolicy) => {
    try {
      await setAmbientSensoryPolicy(personaId, policy);
      // Only commit if this is still the active persona. Otherwise the user
      // switched mid-write and our optimistic local commit would shadow the
      // newly-selected persona's actual policy.
      if (latestPolicyPersonaId !== null && latestPolicyPersonaId !== personaId) return;
      set({ ambientPolicy: policy });
    } catch (err) {
      reportError(err, "Failed to update sensory policy", set as (partial: { error: string }) => void, {
        severity: "toast",
      });
    }
  },

  fetchSensoryPolicy: async (personaId: string) => {
    latestPolicyPersonaId = personaId;
    try {
      const policy = await getAmbientSensoryPolicy(personaId);
      if (latestPolicyPersonaId !== personaId) return;
      set({ ambientPolicy: policy });
    } catch {
      if (latestPolicyPersonaId !== personaId) return;
      set({ ambientPolicy: DEFAULT_SENSORY_POLICY });
    }
  },

  resetSensoryPolicy: async (personaId: string) => {
    try {
      await removeAmbientSensoryPolicy(personaId);
      if (latestPolicyPersonaId !== null && latestPolicyPersonaId !== personaId) return;
      set({ ambientPolicy: DEFAULT_SENSORY_POLICY });
    } catch (err) {
      reportError(err, "Failed to reset sensory policy", set as (partial: { error: string }) => void, {
        severity: "toast",
      });
    }
  },

  // Context Rules actions

  fetchContextRules: async (personaId: string) => {
    latestRulesPersonaId = personaId;
    try {
      const rules = await listContextRules(personaId);
      if (latestRulesPersonaId !== personaId) return;
      set({ contextRules: rules });
    } catch {
      // Silently fail
    }
  },

  addContextRule: async (rule: ContextRule) => {
    try {
      await addContextRule(rule);
      set((state) => ({ contextRules: [...state.contextRules, rule] }));
    } catch (err) {
      reportError(err, "Failed to add context rule", set as (partial: { error: string }) => void, {
        severity: "toast",
      });
    }
  },

  removeContextRule: async (ruleId: string) => {
    try {
      await removeContextRule(ruleId);
      set((state) => ({
        contextRules: state.contextRules.filter((r) => r.id !== ruleId),
      }));
    } catch (err) {
      reportError(err, "Failed to remove context rule", set as (partial: { error: string }) => void, {
        severity: "toast",
      });
    }
  },

  fetchContextRuleMatches: async () => {
    try {
      const matches = await getContextRuleMatches();
      set({ contextRuleMatches: matches });
    } catch {
      // Silently fail
    }
  },

  fetchContextStreamStats: async () => {
    try {
      const stats = await getContextStreamStats();
      set({ contextStreamStats: stats });
    } catch {
      // Silently fail
    }
  },
  };
};
