/**
 * Agent domain store -- personas, tools, executions, tests, lab, mini-player,
 * health-checks, budget enforcement, and chat.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createCoreState, type AgentStore } from "./storeTypes";
import { createDedupedJSONStorage } from "./util/dedupedStorage";

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

export const useAgentStore = create<AgentStore>()(
  persist(
    (...a) => ({
      ...createCoreState(),
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
      storage: createDedupedJSONStorage(),
      partialize: (state) => ({
        selectedPersonaId: state.selectedPersonaId,
        activeChatSessionId: state.activeChatSessionId,
        chatMode: state.chatMode,
      }),
      version: 1,
      // No shape change yet — the hook exists so the NEXT one has somewhere to
      // live instead of silently discarding every persisted selection.
      migrate: (persisted) => persisted,
      // Rehydrate NARROWLY: only the three keys `partialize` writes are taken
      // from the blob. Spreading the whole persisted object over current state
      // (as this did until 2026-09-17) let an older full-store blob - or a
      // quota-truncated one - rehydrate transient fields such as `isLoading`
      // as truth. Also migrates persisted 'ops' chatMode to 'advisory'
      // (renamed in the advisory hub refactor).
      merge: (persisted, current) => {
        const p = persisted as Partial<typeof current> | undefined;
        const rawMode = p?.chatMode as string | undefined;
        const chatMode = (rawMode === 'ops' || rawMode === 'advisory') ? 'advisory' as const : (rawMode === 'agent' ? 'agent' as const : current.chatMode);
        return {
          ...current,
          ...(typeof p?.selectedPersonaId === 'string' || p?.selectedPersonaId === null
            ? { selectedPersonaId: p.selectedPersonaId }
            : {}),
          ...(typeof p?.activeChatSessionId === 'string' || p?.activeChatSessionId === null
            ? { activeChatSessionId: p.activeChatSessionId }
            : {}),
          chatMode,
        };
      },
    },
  ),
);
