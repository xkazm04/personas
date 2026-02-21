/**
 * Persona store facade — composes domain slices into a single Zustand store.
 *
 * Each slice lives in ./slices/<domain>Slice.ts and owns its state + actions.
 * Cross-slice calls work because get() returns the full merged PersonaStore.
 */
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { listen } from "@tauri-apps/api/event";
import type { PersonaStore } from "./storeTypes";

// Re-export shared types for consumers
export { type ActiveDesignSession } from "./storeTypes";

// Slice creators
import { createPersonaSlice } from "./slices/personaSlice";
import { createToolSlice } from "./slices/toolSlice";
import { createTriggerSlice } from "./slices/triggerSlice";
import { createExecutionSlice } from "./slices/executionSlice";
import { createCredentialSlice } from "./slices/credentialSlice";
import { createOverviewSlice } from "./slices/overviewSlice";
import { createMessageSlice } from "./slices/messageSlice";
import { createEventSlice } from "./slices/eventSlice";
import { createObservabilitySlice } from "./slices/observabilitySlice";
import { createHealingSlice } from "./slices/healingSlice";
import { createTeamSlice } from "./slices/teamSlice";
import { createGroupSlice } from "./slices/groupSlice";
import { createMemorySlice } from "./slices/memorySlice";
import { createDesignSlice } from "./slices/designSlice";
import { createUiSlice } from "./slices/uiSlice";
import { createTestSlice } from "./slices/testSlice";
import { createCloudSlice } from "./slices/cloudSlice";

// ── Store ──────────────────────────────────────────────────────────────

export const usePersonaStore = create<PersonaStore>()(
  devtools(
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
        ...createObservabilitySlice(...a),
        ...createHealingSlice(...a),
        ...createTeamSlice(...a),
        ...createGroupSlice(...a),
        ...createMemorySlice(...a),
        ...createDesignSlice(...a),
        ...createUiSlice(...a),
        ...createTestSlice(...a),
        ...createCloudSlice(...a),
      }),
      {
        name: "persona-ui-state",
        partialize: (state) => ({
          sidebarSection: state.sidebarSection,
          credentialView: state.credentialView,
          selectedPersonaId: state.selectedPersonaId,
          overviewTab: state.overviewTab,
          editorTab: state.editorTab,
          settingsTab: state.settingsTab,
        }),
      },
    ),
    { name: "persona-store" },
  ),
);

// ── Healing Listener ───────────────────────────────────────────────────

/** Listen for healing-event from Tauri backend and auto-refresh issues. */
let healingListenerAttached = false;
export function initHealingListener() {
  if (healingListenerAttached) return;
  healingListenerAttached = true;
  listen("healing-event", () => {
    usePersonaStore.getState().fetchHealingIssues();
  });
}
