/**
 * Agent domain store -- personas, tools, executions, tests, lab, mini-player,
 * health-checks, budget enforcement, and chat.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AgentStore } from "./storeTypes";

import { createPersonaSlice } from "./slices/agents/personaSlice";
import { createToolSlice } from "./slices/agents/toolSlice";
import { createExecutionSlice } from "./slices/agents/executionSlice";
import { createTestSlice } from "./slices/agents/testSlice";
import { createLabSlice } from "./slices/agents/labSlice";
import { createMiniPlayerSlice } from "./slices/agents/miniPlayerSlice";
import { createHealthCheckSlice } from "./slices/agents/healthCheckSlice";
import { createBudgetEnforcementSlice } from "./slices/agents/budgetEnforcementSlice";
import { createChatSlice } from "./slices/agents/chatSlice";
import { createBackgroundChatSlice } from "./slices/agents/backgroundChatSlice";
import { createMatrixBuildSlice } from "./slices/agents/matrixBuildSlice";

/**
 * localStorage wrapper that skips writes when the serialized payload is
 * unchanged. Zustand's persist middleware re-runs partialize + setItem on
 * every set(), even when the partialized fields haven't moved. With ~1000
 * sets/sec under load that's 1000 sync localStorage writes/sec for the same
 * 3 persisted fields. The dedupe cuts that to one write per actual change.
 */
const lastWritten = new Map<string, string>();
const dedupedStorage = createJSONStorage(() => ({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    if (lastWritten.get(key) === value) return;
    lastWritten.set(key, value);
    localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    lastWritten.delete(key);
    localStorage.removeItem(key);
  },
}));

export const useAgentStore = create<AgentStore>()(
  persist(
    (...a) => ({
      error: null,
      errorKind: null,
      isLoading: false,
      sliceErrors: {},
      ...createPersonaSlice(...a),
      ...createToolSlice(...a),
      ...createExecutionSlice(...a),
      ...createTestSlice(...a),
      ...createLabSlice(...a),
      ...createMiniPlayerSlice(...a),
      ...createHealthCheckSlice(...a),
      ...createBudgetEnforcementSlice(...a),
      ...createChatSlice(...a),
      ...createBackgroundChatSlice(...a),
      ...createMatrixBuildSlice(...a),
    }),
    {
      name: "persona-ui-agents",
      storage: dedupedStorage,
      partialize: (state) => ({
        selectedPersonaId: state.selectedPersonaId,
        activeChatSessionId: state.activeChatSessionId,
        chatMode: state.chatMode,
      }),
      // Migrate persisted 'ops' chatMode to 'advisory' (renamed in advisory hub refactor)
      merge: (persisted, current) => {
        const p = persisted as Partial<typeof current> | undefined;
        const rawMode = p?.chatMode as string | undefined;
        const chatMode = (rawMode === 'ops' || rawMode === 'advisory') ? 'advisory' as const : (rawMode === 'agent' ? 'agent' as const : current.chatMode);
        return { ...current, ...p, chatMode };
      },
    },
  ),
);
