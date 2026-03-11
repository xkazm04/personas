/**
 * Persona store facade — composes domain slices into a single Zustand store.
 *
 * Each slice lives in ./slices/<domain>Slice.ts and owns its state + actions.
 * Cross-slice calls work because get() returns the full merged PersonaStore.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listen } from "@tauri-apps/api/event";
import type { PersonaStore } from "./storeTypes";

// Slice creators
import { createPersonaSlice } from "./slices/agents/personaSlice";
import { createToolSlice } from "./slices/agents/toolSlice";
import { createTriggerSlice } from "./slices/pipeline/triggerSlice";
import { createExecutionSlice } from "./slices/agents/executionSlice";
import { createCredentialSlice } from "./slices/vault/credentialSlice";
import { createOverviewSlice } from "./slices/overview/overviewSlice";
import { createMessageSlice } from "./slices/overview/messageSlice";
import { createEventSlice } from "./slices/overview/eventSlice";
import { createHealingSlice } from "./slices/overview/healingSlice";
import { createTeamSlice } from "./slices/pipeline/teamSlice";
import { createGroupSlice } from "./slices/pipeline/groupSlice";
import { createMemorySlice } from "./slices/overview/memorySlice";
import { createUiSlice } from "./slices/system/uiSlice";
import { createTestSlice } from "./slices/agents/testSlice";
import { createLabSlice } from "./slices/agents/labSlice";
import { createCloudSlice } from "./slices/system/cloudSlice";
import { createGitLabSlice } from "./slices/system/gitlabSlice";
import { createDatabaseSlice } from "./slices/vault/databaseSlice";
import { createRecipeSlice } from "./slices/pipeline/recipeSlice";
import { createAutomationSlice } from "./slices/vault/automationSlice";
import { createOnboardingSlice } from "./slices/system/onboardingSlice";
import { createCronAgentsSlice } from "./slices/overview/cronAgentsSlice";
import { createMiniPlayerSlice } from "./slices/agents/miniPlayerSlice";
import { createHealthCheckSlice } from "./slices/agents/healthCheckSlice";
import { createTourSlice } from "./slices/system/tourSlice";
import { createBudgetEnforcementSlice } from "./slices/agents/budgetEnforcementSlice";
import { createAlertSlice } from "./slices/overview/alertSlice";
import { createViewModeSlice } from "./slices/system/viewModeSlice";
import { createDevToolsSlice } from "./slices/system/devToolsSlice";
import { AUTH_LOGIN_EVENT } from "./authStore";

// ── Store ──────────────────────────────────────────────────────────────

export const usePersonaStore = create<PersonaStore>()(
    persist(
      (...a) => ({
        ...createPersonaSlice(...a),
        ...createToolSlice(...a),
        ...createTriggerSlice(...a),
        ...createExecutionSlice(...a),
        ...createCredentialSlice(...a),
        ...createOverviewSlice(...a),
        ...createMessageSlice(...a),
        ...createEventSlice(...a),
        ...createHealingSlice(...a),
        ...createTeamSlice(...a),
        ...createGroupSlice(...a),
        ...createMemorySlice(...a),
        ...createUiSlice(...a),
        ...createTestSlice(...a),
        ...createLabSlice(...a),
        ...createCloudSlice(...a),
        ...createGitLabSlice(...a),
        ...createDatabaseSlice(...a),
        ...createRecipeSlice(...a),
        ...createAutomationSlice(...a),
        ...createOnboardingSlice(...a),
        ...createCronAgentsSlice(...a),
        ...createMiniPlayerSlice(...a),
        ...createHealthCheckSlice(...a),
        ...createTourSlice(...a),
        ...createBudgetEnforcementSlice(...a),
        ...createAlertSlice(...a),
        ...createViewModeSlice(...a),
        ...createDevToolsSlice(...a),
      }),
      {
        name: "persona-ui-state",
        partialize: (state) => ({
          sidebarSection: state.sidebarSection,
          homeTab: state.homeTab,
          selectedPersonaId: state.selectedPersonaId,
          overviewTab: state.overviewTab,
          editorTab: state.editorTab,
          cloudTab: state.cloudTab,
          settingsTab: state.settingsTab,
          onboardingCompleted: state.onboardingCompleted,
          tourCompleted: state.tourCompleted,
          tourDismissed: state.tourDismissed,
          viewMode: state.viewMode,
        }),
      },
    ),
);

// ── Auth Bridge ───────────────────────────────────────────────────────

let authBridgeAttached = false;
function initAuthBridgeListener() {
  if (authBridgeAttached || typeof window === "undefined") return;
  authBridgeAttached = true;
  window.addEventListener(AUTH_LOGIN_EVENT, () => {
    usePersonaStore.getState().cloudInitialize();
  });
}

initAuthBridgeListener();

// ── Healing Listener ──────────────────────────────────────────────────

/** Listen for healing-event from Tauri backend and auto-refresh issues. */
let healingListenerAttached = false;
export function initHealingListener() {
  if (healingListenerAttached) return;
  healingListenerAttached = true;
  listen("healing-event", () => {
    usePersonaStore.getState().fetchHealingIssues();
  });
}
