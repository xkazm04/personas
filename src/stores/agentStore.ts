/**
 * Agent domain store -- personas, tools, executions, tests, lab, mini-player,
 * health-checks, budget enforcement, and chat.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
import { createMatrixBuildSlice } from "./slices/agents/matrixBuildSlice";

export const useAgentStore = create<AgentStore>()(
  persist(
    (...a) => ({
      error: null,
      errorKind: null,
      isLoading: false,
      ...createPersonaSlice(...a),
      ...createToolSlice(...a),
      ...createExecutionSlice(...a),
      ...createTestSlice(...a),
      ...createLabSlice(...a),
      ...createMiniPlayerSlice(...a),
      ...createHealthCheckSlice(...a),
      ...createBudgetEnforcementSlice(...a),
      ...createChatSlice(...a),
      ...createMatrixBuildSlice(...a),
    }),
    {
      name: "persona-ui-agents",
      partialize: (state) => ({
        selectedPersonaId: state.selectedPersonaId,
        activeChatSessionId: state.activeChatSessionId,
        chatMode: state.chatMode,
      }),
    },
  ),
);
