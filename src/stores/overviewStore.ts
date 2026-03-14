/**
 * Overview domain store -- dashboard, messages, events, healing, memories,
 * cron agents, and alerts.
 *
 * Alert state (rules, history, fired-cooldowns) is persisted via Zustand
 * persist middleware, replacing the legacy hand-rolled localStorage layer.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OverviewStore } from "./storeTypes";
import { MAX_ALERT_HISTORY } from "./slices/overview/alertSlice";

import { createOverviewSlice } from "./slices/overview/overviewSlice";
import { createMessageSlice } from "./slices/overview/messageSlice";
import { createEventSlice } from "./slices/overview/eventSlice";
import { createHealingSlice } from "./slices/overview/healingSlice";
import { createMemorySlice } from "./slices/overview/memorySlice";
import { createCronAgentsSlice } from "./slices/overview/cronAgentsSlice";
import { createAlertSlice } from "./slices/overview/alertSlice";

// Keys used by the old hand-rolled persistence — removed after migration.
const LEGACY_KEYS = [
  '__personas_alert_rules',
  '__personas_alert_history',
  '__personas_alert_fired',
] as const;

export const useOverviewStore = create<OverviewStore>()(
  persist(
    (...a) => ({
      error: null,
      isLoading: false,
      ...createOverviewSlice(...a),
      ...createMessageSlice(...a),
      ...createEventSlice(...a),
      ...createHealingSlice(...a),
      ...createMemorySlice(...a),
      ...createCronAgentsSlice(...a),
      ...createAlertSlice(...a),
    }),
    {
      name: "persona-ui-overview",
      partialize: (state) => ({
        alertRules: state.alertRules,
        alertHistory: state.alertHistory.slice(0, MAX_ALERT_HISTORY),
        alertFiredCooldowns: state.alertFiredCooldowns,
      }),
      onRehydrateStorage: () => {
        // Before Zustand hydrates, migrate any legacy localStorage data so
        // existing users don't lose their alert configuration.
        let migrated: Partial<Pick<OverviewStore, 'alertRules' | 'alertHistory' | 'alertFiredCooldowns'>> | null = null;

        try {
          const stored = localStorage.getItem('persona-ui-overview');
          if (!stored) {
            // First run after migration — check for legacy keys
            const rawRules = localStorage.getItem(LEGACY_KEYS[0]);
            const rawHistory = localStorage.getItem(LEGACY_KEYS[1]);
            const rawFired = localStorage.getItem(LEGACY_KEYS[2]);

            if (rawRules || rawHistory || rawFired) {
              migrated = {
                alertRules: rawRules ? JSON.parse(rawRules) : [],
                alertHistory: rawHistory ? JSON.parse(rawHistory).slice(0, MAX_ALERT_HISTORY) : [],
                alertFiredCooldowns: rawFired
                  ? Object.fromEntries(JSON.parse(rawFired) as [string, number][])
                  : {},
              };
            }
          }
        } catch {
          // Migration is best-effort
        }

        return (state) => {
          // Apply migrated data if Zustand had nothing persisted
          if (state && migrated) {
            if (state.alertRules.length === 0 && migrated.alertRules) {
              state.alertRules = migrated.alertRules;
            }
            if (state.alertHistory.length === 0 && migrated.alertHistory) {
              state.alertHistory = migrated.alertHistory;
            }
            if (Object.keys(state.alertFiredCooldowns).length === 0 && migrated.alertFiredCooldowns) {
              state.alertFiredCooldowns = migrated.alertFiredCooldowns;
            }
          }

          // Clean up legacy keys regardless
          for (const key of LEGACY_KEYS) {
            localStorage.removeItem(key);
          }
        };
      },
    },
  ),
);
