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

import { type UnlistenFn } from "@tauri-apps/api/event";
import { EventName, typedListen } from "@/lib/eventRegistry";
import { AUTH_LOGIN_EVENT, useAuthStore } from "@/stores/authStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";

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
    event: EventName.AUTH_STATE_CHANGED,
    setup: async () => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const unlisten = await typedListen(
        EventName.AUTH_STATE_CHANGED,
        (payload) => {
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            const prev = useAuthStore.getState();
            useAuthStore.setState({
              user: payload.user,
              isAuthenticated: payload.is_authenticated,
              isOffline: payload.is_offline,
              isLoading: false,
            });

            // Notify downstream when user becomes authenticated.
            if (payload.is_authenticated && !prev.isAuthenticated) {
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

  // -- Auth error (callback failures surfaced from Rust) --------------------
  {
    event: EventName.AUTH_ERROR,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.AUTH_ERROR,
        (payload) => {
          const msg = payload?.error ?? "Authentication failed";
          console.error("[auth-error]", msg);
          useAuthStore.setState({
            isLoading: false,
            error: msg,
          });
        },
      );
      return [unlisten];
    },
  },

  // -- Healing event -------------------------------------------------------
  {
    event: EventName.HEALING_EVENT,
    setup: async () => {
      const unlisten = await typedListen(EventName.HEALING_EVENT, () => {
        useOverviewStore.getState().fetchHealingIssues();
      });
      return [unlisten];
    },
  },

  // -- Rotation completed / anomaly ----------------------------------------
  {
    event: EventName.ROTATION_COMPLETED,
    setup: async () => {
      const unlistenCompleted = await typedListen(
        EventName.ROTATION_COMPLETED,
        (payload) => {
          const { credential_id } = payload;
          useVaultStore.getState().fetchRotationStatus(credential_id);
        },
      );

      const unlistenAnomaly = await typedListen(
        EventName.ROTATION_ANOMALY,
        (payload) => {
          const { credential_id } = payload;
          useVaultStore.getState().fetchRotationStatus(credential_id);
        },
      );

      return [unlistenCompleted, unlistenAnomaly];
    },
  },

  // -- Zombie execution detection ------------------------------------------
  {
    event: EventName.ZOMBIE_EXECUTIONS_DETECTED,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.ZOMBIE_EXECUTIONS_DETECTED,
        (payload) => {
          const { zombie_ids, count } = payload;
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

  // -- Auto-rollback notification -------------------------------------------
  {
    event: EventName.AUTO_ROLLBACK_TRIGGERED,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.AUTO_ROLLBACK_TRIGGERED,
        (payload) => {
          const { personaName, fromVersion, toVersion } = payload;
          useToastStore
            .getState()
            .addToast(
              `Auto-rollback: "${personaName}" reverted from v${fromVersion} to v${toVersion} due to elevated error rate`,
              "error",
              8000,
            );
        },
      );
      return [unlisten];
    },
  },

  // -- Build session events (background resilience) -------------------------
  // Only processes events when the Channel handler is NOT active (user navigated away).
  // When the matrix component is mounted, the Channel handler processes events directly.
  // This prevents double-processing that causes "updated" state on first resolve.
  {
    event: EventName.BUILD_SESSION_EVENT,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.BUILD_SESSION_EVENT,
        (payload) => {
          // Skip if Channel handler is active (component mounted)
          if ((window as unknown as Record<string, unknown>).__BUILD_CHANNEL_ACTIVE__) return;

          const store = useAgentStore.getState();

          // Only process events for the active build session
          if (!store.buildSessionId || payload.session_id !== store.buildSessionId) return;

          switch (payload.type) {
            case "cell_update":
              store.handleBuildCellUpdate(payload as Parameters<typeof store.handleBuildCellUpdate>[0]);
              break;
            case "question":
              store.handleBuildQuestion(payload as Parameters<typeof store.handleBuildQuestion>[0]);
              break;
            case "progress":
              store.handleBuildProgress(payload as Parameters<typeof store.handleBuildProgress>[0]);
              break;
            case "error":
              store.handleBuildError(payload as Parameters<typeof store.handleBuildError>[0]);
              break;
            case "session_status":
              store.handleBuildSessionStatus(payload as Parameters<typeof store.handleBuildSessionStatus>[0]);
              break;
          }
        },
      );
      return [unlisten];
    },
  },

  // -- Network snapshot pushed from Rust P2P engine --------------------------
  {
    event: EventName.NETWORK_SNAPSHOT_UPDATED,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.NETWORK_SNAPSHOT_UPDATED,
        (payload) => {
          useSystemStore.setState({
            networkStatus: payload.status,
            connectionHealth: payload.health,
            discoveredPeers: payload.discoveredPeers,
            messagingMetrics: payload.messagingMetrics,
            connectionMetrics: payload.connectionMetrics,
            manifestSyncMetrics: payload.manifestSyncMetrics,
            networkConsecutiveFailures: 0,
            networkError: null,
          });
        },
      );
      return [unlisten];
    },
  },

  // -- Share link received (OS deep link) -----------------------------------
  {
    event: EventName.SHARE_LINK_RECEIVED,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.SHARE_LINK_RECEIVED,
        (payload) => {
          const url = payload?.url;
          if (url && typeof url === "string") {
            tracing("[share-link-received]", url);
            // Dispatch a DOM event so any mounted import dialog can react.
            window.dispatchEvent(
              new CustomEvent("personas:share-link", { detail: { url } }),
            );
          }
        },
      );
      return [unlisten];
    },
  },
];

function tracing(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.info(...args);
}

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

  // Kick off backend template integrity verification (defense-in-depth).
  // Runs async and doesn't block app startup.
  void import("@/lib/personas/templates/templateCatalog").then((m) =>
    m.verifyTemplatesWithBackend(),
  );
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
