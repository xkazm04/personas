/**
 * Persona store facade -- backward-compatible combined store backed by
 * independent domain stores.
 *
 * New code should import from domain stores directly for better perf:
 *   - useAgentStore    (agents, tools, executions, tests, lab, …)
 *   - useOverviewStore (dashboard, messages, events, healing, memories, …)
 *   - usePipelineStore (triggers, teams, groups, recipes)
 *   - useVaultStore    (credentials, databases, automations, rotation)
 *   - useSystemStore   (UI, cloud, gitlab, onboarding, tour, …)
 *
 * This facade subscribes to ALL domain stores, so every set() in any domain
 * still notifies every subscriber here. Migrate callers to domain stores to
 * get the ~80% selector-evaluation reduction.
 */
import { createStore, useStore } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { PersonaStore } from "./storeTypes";

import { useAgentStore } from "./agentStore";
import { useOverviewStore } from "./overviewStore";
import { usePipelineStore } from "./pipelineStore";
import { useVaultStore } from "./vaultStore";
import { useSystemStore } from "./systemStore";
import { AUTH_LOGIN_EVENT } from "./authStore";

// -- Combined store -------------------------------------------------------

function getCombinedState(): PersonaStore {
  return {
    ...useAgentStore.getState(),
    ...useOverviewStore.getState(),
    ...usePipelineStore.getState(),
    ...useVaultStore.getState(),
    ...useSystemStore.getState(),
  } as PersonaStore;
}

const combinedApi = createStore<PersonaStore>()(() => getCombinedState());

// Sync: domain stores → combined store
useAgentStore.subscribe(() => combinedApi.setState(getCombinedState()));
useOverviewStore.subscribe(() => combinedApi.setState(getCombinedState()));
usePipelineStore.subscribe(() => combinedApi.setState(getCombinedState()));
useVaultStore.subscribe(() => combinedApi.setState(getCombinedState()));
useSystemStore.subscribe(() => combinedApi.setState(getCombinedState()));

// -- Persist migration ----------------------------------------------------
// Hydrate domain stores from the legacy "persona-ui-state" localStorage key
// so users don't lose their preferences after the store split.
try {
  const legacy = localStorage.getItem("persona-ui-state");
  if (legacy) {
    const { state } = JSON.parse(legacy) as { state: Record<string, unknown> };
    if (state) {
      // Agent store fields
      if (state.selectedPersonaId != null) {
        useAgentStore.setState({ selectedPersonaId: state.selectedPersonaId as string });
      }
      // System store fields
      const systemFields = [
        "sidebarSection", "homeTab", "overviewTab", "editorTab", "cloudTab",
        "settingsTab", "onboardingCompleted", "tourCompleted", "tourDismissed",
        "viewMode", "setupRole", "setupTool", "setupGoal", "setupCompleted",
      ] as const;
      const systemPatch: Record<string, unknown> = {};
      for (const key of systemFields) {
        if (state[key] != null) systemPatch[key] = state[key];
      }
      if (Object.keys(systemPatch).length > 0) {
        useSystemStore.setState(systemPatch);
      }
      // Remove legacy key after migration
      localStorage.removeItem("persona-ui-state");
    }
  }
} catch {
  // intentional: localStorage may be unavailable
}

// -- Hook (backward-compatible) -------------------------------------------

/**
 * @deprecated Prefer domain-specific stores (useAgentStore, useOverviewStore,
 * usePipelineStore, useVaultStore, useSystemStore) for better performance.
 */
export function usePersonaStore<T>(selector: (state: PersonaStore) => T): T {
  return useStore(combinedApi, selector);
}

// Expose static API surface for non-hook callers (listeners, effects)
usePersonaStore.getState = combinedApi.getState;
usePersonaStore.setState = combinedApi.setState;
usePersonaStore.subscribe = combinedApi.subscribe;

// -- Auth Bridge -----------------------------------------------------------

let authBridgeAttached = false;
function initAuthBridgeListener() {
  if (authBridgeAttached || typeof window === "undefined") return;
  authBridgeAttached = true;
  window.addEventListener(AUTH_LOGIN_EVENT, () => {
    useSystemStore.getState().cloudInitialize();
  });
}

initAuthBridgeListener();

// -- Healing Listener ------------------------------------------------------

/** Listen for healing-event from Tauri backend and auto-refresh issues. */
let healingListenerAttached = false;
export function initHealingListener() {
  if (healingListenerAttached) return;
  healingListenerAttached = true;
  listen("healing-event", () => {
    useOverviewStore.getState().fetchHealingIssues();
  });
}

// -- Rotation Listener -----------------------------------------------------

/** Listen for rotation-completed and rotation-anomaly events from the backend
 *  scheduler. When a rotation completes (success or failure), refresh the
 *  rotation status for that credential so the UI stays current. */
let rotationListenerAttached = false;
export function initRotationListener() {
  if (rotationListenerAttached) return;
  rotationListenerAttached = true;
  listen<{ credential_id: string; status: string }>("rotation-completed", (event) => {
    const { credential_id } = event.payload;
    useVaultStore.getState().fetchRotationStatus(credential_id);
  });
  listen<{ credential_id: string }>("rotation-anomaly", (event) => {
    const { credential_id } = event.payload;
    useVaultStore.getState().fetchRotationStatus(credential_id);
  });
}

// -- Zombie Execution Listener ---------------------------------------------

/** Listen for zombie-executions-detected from the backend sweep.
 *  When zombie executions are transitioned to incomplete, refresh the
 *  execution list and warn the user if they're currently viewing an execution. */
let zombieListenerAttached = false;
export function initZombieExecutionListener() {
  if (zombieListenerAttached) return;
  zombieListenerAttached = true;
  listen<{ zombie_ids: string[]; count: number }>("zombie-executions-detected", (event) => {
    const { zombie_ids, count } = event.payload;
    console.warn(`[zombie-sweep] ${count} stale execution(s) transitioned to incomplete:`, zombie_ids);
    const state = useAgentStore.getState();
    if (state.activeExecutionId && zombie_ids.includes(state.activeExecutionId)) {
      state.finishExecution('incomplete', { errorMessage: 'Execution stalled and was automatically marked as incomplete' });
    }
  });
}
