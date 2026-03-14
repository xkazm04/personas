/**
 * EventBridge — centralised Tauri backend → frontend event subscription manager.
 *
 * All Tauri `listen()` subscriptions that were previously scattered across store
 * files with ad-hoc boolean guards are registered here declaratively.  The module
 * exposes two functions:
 *
 *  • `initAllListeners()`  – attach every registered subscription (idempotent).
 *  • `teardownAllListeners()` – detach them (useful for tests / hot-reload).
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AUTH_LOGIN_EVENT, useAuthStore } from "@/stores/authStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { AuthStateResponse } from "@/api/auth/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventRegistration {
  /** Tauri event name (or "window:<name>" for DOM events). */
  event: string;
  /** Setup function that calls `listen()` and returns unlisten handles. */
  setup: () => Promise<UnlistenFn[]>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let attached = false;
const unlisteners: UnlistenFn[] = [];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Each entry describes one logical subscription group.  The `setup` function
 * may register multiple Tauri listeners (e.g. rotation registers two events)
 * and must return the unlisten handles so they can be cleaned up later.
 */
const registry: EventRegistration[] = [
  // -- Auth state changed --------------------------------------------------
  {
    event: "auth-state-changed",
    setup: async () => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const unlisten = await listen<AuthStateResponse>(
        "auth-state-changed",
        (event) => {
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            const prev = useAuthStore.getState();
            const state = event.payload;
            useAuthStore.setState({
              user: state.user,
              isAuthenticated: state.is_authenticated,
              isOffline: state.is_offline,
              isLoading: false,
            });

            // Notify downstream when user becomes authenticated.
            if (state.is_authenticated && !prev.isAuthenticated) {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
              }
            }
          }, 100);
        },
      );

      return [unlisten];
    },
  },

  // -- Auth bridge (DOM event → cloud init) --------------------------------
  {
    event: `window:${AUTH_LOGIN_EVENT}`,
    setup: async () => {
      const handler = () => {
        useSystemStore.getState().cloudInitialize();
      };
      window.addEventListener(AUTH_LOGIN_EVENT, handler);
      // Return an unlisten that removes the DOM listener.
      return [() => window.removeEventListener(AUTH_LOGIN_EVENT, handler)];
    },
  },

  // -- Healing event -------------------------------------------------------
  {
    event: "healing-event",
    setup: async () => {
      const unlisten = await listen("healing-event", () => {
        useOverviewStore.getState().fetchHealingIssues();
      });
      return [unlisten];
    },
  },

  // -- Rotation completed / anomaly ----------------------------------------
  {
    event: "rotation-completed",
    setup: async () => {
      const unlistenCompleted = await listen<{
        credential_id: string;
        status: string;
      }>("rotation-completed", (event) => {
        const { credential_id } = event.payload;
        useVaultStore.getState().fetchRotationStatus(credential_id);
      });

      const unlistenAnomaly = await listen<{ credential_id: string }>(
        "rotation-anomaly",
        (event) => {
          const { credential_id } = event.payload;
          useVaultStore.getState().fetchRotationStatus(credential_id);
        },
      );

      return [unlistenCompleted, unlistenAnomaly];
    },
  },

  // -- Zombie execution detection ------------------------------------------
  {
    event: "zombie-executions-detected",
    setup: async () => {
      const unlisten = await listen<{ zombie_ids: string[]; count: number }>(
        "zombie-executions-detected",
        (event) => {
          const { zombie_ids, count } = event.payload;
          console.warn(
            `[zombie-sweep] ${count} stale execution(s) transitioned to incomplete:`,
            zombie_ids,
          );
          const state = useAgentStore.getState();
          if (
            state.activeExecutionId &&
            zombie_ids.includes(state.activeExecutionId)
          ) {
            state.finishExecution("incomplete", {
              errorMessage:
                "Execution stalled and was automatically marked as incomplete",
            });
          }
        },
      );
      return [unlisten];
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach all registered Tauri event listeners.  Safe to call multiple times —
 * subsequent calls are no-ops until `teardownAllListeners()` is called.
 */
export async function initAllListeners(): Promise<void> {
  if (attached) return;
  attached = true;

  const results = await Promise.allSettled(
    registry.map((reg) => reg.setup()),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      unlisteners.push(...result.value);
    } else {
      console.error("[EventBridge] Failed to attach listener:", result.reason);
    }
  }
}

/**
 * Detach all listeners previously attached by `initAllListeners()`.
 * Useful for tests, hot-reload, and app shutdown.
 */
export async function teardownAllListeners(): Promise<void> {
  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch {
      // intentional: best-effort cleanup
    }
  }
  unlisteners.length = 0;
  attached = false;
}
