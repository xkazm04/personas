import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import type { ObservabilityMetrics } from "@/lib/bindings/ObservabilityMetrics";
import * as api from "@/api/tauriApi";

export interface ObservabilitySlice {
  // State
  observabilityMetrics: ObservabilityMetrics | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promptVersions: any[];

  // Actions
  fetchObservabilityMetrics: (days?: number, personaId?: string) => Promise<void>;
  fetchPromptVersions: (personaId: string) => Promise<void>;
}

export const createObservabilitySlice: StateCreator<PersonaStore, [], [], ObservabilitySlice> = (set) => ({
  observabilityMetrics: null,
  promptVersions: [],

  fetchObservabilityMetrics: async (days = 30, personaId?: string) => {
    try {
      const [summary, timeSeries] = await Promise.all([
        api.getMetricsSummary(days),
        api.getLiveMetricsTimeseries(days, personaId),
      ]);
      set({ observabilityMetrics: { summary, timeSeries } });
    } catch {
      // Silent fail
    }
  },

  fetchPromptVersions: async (personaId) => {
    try {
      const versions = await api.getPromptVersions(personaId);
      set({ promptVersions: versions });
    } catch {
      // Silent fail
    }
  },
});
