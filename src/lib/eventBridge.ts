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
import { AUTH_LOGIN_EVENT, clearLoginTimeout, useAuthStore } from "@/stores/authStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";
import { useNotificationCenterStore } from "@/stores/notificationCenterStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("event-bridge");

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/**
 * Named timing knobs for every subscription in this file. Every value here
 * was chosen deliberately — edit only with a matching update to the
 * "What breaks if" note so future readers don't treat these as arbitrary.
 */
const EVENT_BRIDGE_TIMING = {
  /**
   * Debounce for `AUTH_STATE_CHANGED`. A successful OAuth fires several
   * consecutive state events in <50ms; coalescing into one update avoids a
   * brief "unauthenticated → authenticated → unauthenticated" flicker in
   * the UI. Halving to 50ms stops coalescing; doubling to 200ms makes
   * post-login chrome visibly lag.
   */
  AUTH_STATE_DEBOUNCE_MS: 100,
  /**
   * Debounce for `PERSONA_HEALTH_CHANGED`. Chain triggers routinely fire
   * several health events in ~200ms; one `fetchPersonaSummaries` is enough.
   * Halving causes duplicate fetches; doubling delays the dashboard update
   * past the point the user expects to see it.
   */
  PERSONA_HEALTH_DEBOUNCE_MS: 300,
  /**
   * Throttle for `NETWORK_SNAPSHOT_UPDATED`. The Rust P2P engine can emit
   * snapshots faster than React can re-render them. Halving causes dropped
   * frames during peer churn; doubling lets the dock stale-render connection
   * counts for a visibly long time.
   */
  NETWORK_SNAPSHOT_THROTTLE_MS: 500,
  /**
   * Fallback delay for backend template integrity verification when the
   * browser has no `requestIdleCallback`. Idle is preferred, but Safari-like
   * engines need an explicit deferral. Halving competes with startup IPC;
   * doubling leaves templates unverified for longer on those platforms.
   */
  TEMPLATE_VERIFICATION_FALLBACK_MS: 3_000,
  /**
   * Auth login timeout tripwire documented in comments on
   * `AUTH_STATE_CHANGED`: if no state event arrives 120s after login is
   * initiated, the login is cancelled. Defined here for reference; the
   * actual timer lives in `authStore`.
   */
  AUTH_LOGIN_TIMEOUT_MS: 120_000,
  /**
   * Concurrent IPC calls during cold-start listener registration.
   * Tauri's IPC bridge can serialize but not parallelize beyond its thread
   * pool, and starting >5 listeners in parallel on a cold app produced
   * noticeable jank in profiling. Halving under-uses the pool; doubling
   * regresses startup latency on slow machines.
   */
  INIT_BATCH_SIZE: 5,
  /**
   * Debounce for `TITLEBAR_NOTIFICATION`. Each persona dispatch is an independent
   * notification — no coalescing in v1.2 so the bell updates immediately on every message.
   * A future "grouping" feature would increase this. (DELIV-04)
   */
  TITLEBAR_NOTIFICATION_DEBOUNCE_MS: 0,
} as const;

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
          // Clear login timeout immediately on any auth state event to
          // prevent the 120s fallback from firing after a successful OAuth.
          if (payload.is_authenticated) clearLoginTimeout();
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            const prev = useAuthStore.getState();
            useAuthStore.setState({
              user: payload.user,
              isAuthenticated: payload.is_authenticated,
              isOffline: payload.is_offline,
              isOfflineAuthenticated: payload.is_offline_authenticated,
              isLoading: false,
            });

            // Notify downstream when user becomes authenticated.
            if (payload.is_authenticated && !prev.isAuthenticated) {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent(AUTH_LOGIN_EVENT));
              }
            }
          }, EVENT_BRIDGE_TIMING.AUTH_STATE_DEBOUNCE_MS);
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
          logger.error("Auth error", { detail: msg });
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
          logger.warn("Zombie executions transitioned to incomplete", { count, zombie_ids });
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

  // -- Engine fallback notification ------------------------------------------
  {
    event: EventName.ENGINE_FALLBACK,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.ENGINE_FALLBACK,
        (payload) => {
          useToastStore
            .getState()
            .addToast(
              `Unrecognized engine "${payload.requested}" in settings — falling back to ${payload.actual}`,
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
          // Skip if this specific session's Channel is currently live.
          // Per-session scoping (vs. a global boolean flag) avoids the
          // multi-instance bug where unmounting one build surface opened a
          // double-processing window for another still-active session.
          const activeSet = (window as unknown as Record<string, unknown>)
            .__BUILD_CHANNEL_ACTIVE_SESSIONS__ as Set<string> | undefined;
          if (activeSet && activeSet.has(payload.session_id)) return;

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
            case "behavior_core_update":
              store.handleBehaviorCoreUpdate(payload as Parameters<typeof store.handleBehaviorCoreUpdate>[0]);
              break;
            case "capability_enumeration_update":
              store.handleCapabilityEnumerationUpdate(payload as Parameters<typeof store.handleCapabilityEnumerationUpdate>[0]);
              break;
            case "capability_resolution_update":
              store.handleCapabilityResolutionUpdate(payload as Parameters<typeof store.handleCapabilityResolutionUpdate>[0]);
              break;
            case "persona_resolution_update":
              store.handlePersonaResolutionUpdate(payload as Parameters<typeof store.handlePersonaResolutionUpdate>[0]);
              break;
            case "clarifying_question_v3":
              store.handleClarifyingQuestionV3(payload as Parameters<typeof store.handleClarifyingQuestionV3>[0]);
              break;
          }
        },
      );
      return [unlisten];
    },
  },

  // -- Process activity (global background process lifecycle) -----------------
  {
    event: EventName.PROCESS_ACTIVITY,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.PROCESS_ACTIVITY,
        (payload) => {
          const store = useOverviewStore.getState();
          if (payload.action === "started") {
            store.processStarted(payload.domain, payload.run_id, payload.label);
          } else if (payload.action === "queued") {
            store.processQueued(payload.domain, payload.run_id, payload.label);
          } else {
            store.processEnded(payload.domain, payload.action, payload.run_id);
          }
        },
      );
      return [unlisten];
    },
  },

  // -- Execution status → Notification Center ---------------------------------
  // Surfaces failed / cancelled / incomplete executions in the TitleBar
  // notification bell. PROCESS_ACTIVITY already drives the live dock indicator,
  // but its payload lacks the error message — EXECUTION_STATUS carries it, so
  // that's the right event for a user-facing notification. The process record
  // populated by PROCESS_ACTIVITY is re-used to recover the persona name.
  {
    event: EventName.EXECUTION_STATUS,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.EXECUTION_STATUS,
        (payload) => {
          const { status, execution_id, error } = payload;
          if (status !== "failed" && status !== "cancelled" && status !== "incomplete") {
            return;
          }

          // PROCESS_ACTIVITY "failed"/"cancelled" fires just before this event
          // and may have already moved the row from activeProcesses to
          // recentProcesses — check both.
          const overview = useOverviewStore.getState();
          const proc =
            overview.activeProcesses[`execution:${execution_id}`]
            ?? overview.recentProcesses.find((p) => p.runId === execution_id);

          const notificationStatus =
            status === "cancelled" ? "canceled"
            : status === "incomplete" ? "warning"
            : "failed";

          const fallbackSummary =
            status === "cancelled" ? "Execution was cancelled"
            : status === "incomplete" ? "Execution finished incomplete"
            : "Execution failed";

          useNotificationCenterStore.getState().addProcessNotification({
            processType: "execution",
            personaId: proc?.personaId ?? null,
            personaName: proc?.label ?? null,
            status: notificationStatus,
            summary: error ?? fallbackSummary,
            redirectSection: "agents",
            redirectTab: null,
          });
        },
      );
      return [unlisten];
    },
  },

  // -- Queue status (execution queued/promoted in global queue) ---------------
  {
    event: EventName.QUEUE_STATUS,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.QUEUE_STATUS,
        (payload) => {
          const store = useOverviewStore.getState();
          if (payload.action === "queued") {
            store.processQueued(
              "execution",
              payload.execution_id,
              undefined,
              payload.position,
              payload.persona_id,
            );
          } else if (payload.action === "promoted") {
            store.processPromoted(payload.execution_id);
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
      // Throttle: apply at most once per 500ms to avoid rapid re-renders
      // when the P2P engine fires snapshots in quick succession.
      let pending: Record<string, unknown> | undefined;
      let throttleTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (pending) { useSystemStore.setState(pending); pending = undefined; }
        throttleTimer = null;
      };
      const unlisten = await typedListen(
        EventName.NETWORK_SNAPSHOT_UPDATED,
        (payload) => {
          pending = {
            networkStatus: payload.status,
            connectionHealth: payload.health,
            discoveredPeers: payload.discoveredPeers,
            messagingMetrics: payload.messagingMetrics,
            connectionMetrics: payload.connectionMetrics,
            manifestSyncMetrics: payload.manifestSyncMetrics,
            networkConsecutiveFailures: 0,
            networkError: null,
          };
          if (!throttleTimer) throttleTimer = setTimeout(flush, EVENT_BRIDGE_TIMING.NETWORK_SNAPSHOT_THROTTLE_MS);
        },
      );
      // Teardown contract: cancel the pending throttle timer AND drop the
      // pending snapshot. Previously this flushed one last setState on the
      // way out, which committed a stale network status into a store that
      // was about to be reset (HMR, logout), producing ghost-network rows
      // in tests and briefly after logout. Teardown must not mutate app
      // state — if a snapshot is in flight, it's discarded.
      return [
        unlisten,
        () => {
          if (throttleTimer) clearTimeout(throttleTimer);
          throttleTimer = null;
          pending = undefined;
        },
      ];
    },
  },

  // -- Persona health changed (push-based from backend) ---------------------
  {
    event: EventName.PERSONA_HEALTH_CHANGED,
    setup: async () => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const unlisten = await typedListen(
        EventName.PERSONA_HEALTH_CHANGED,
        () => {
          // Debounce: multiple executions finishing in rapid succession
          // (e.g. chain triggers) should coalesce into a single fetch.
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            useAgentStore.getState().fetchPersonaSummaries();
          }, EVENT_BRIDGE_TIMING.PERSONA_HEALTH_DEBOUNCE_MS);
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

  // -- TitleBar notification (persona message delivery — v3.2 DELIV-04) ------
  {
    event: EventName.TITLEBAR_NOTIFICATION,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.TITLEBAR_NOTIFICATION,
        (payload) => {
          // Pure store.set() — no IPC, no re-entrancy risk (T-19-01 mitigation).
          useNotificationCenterStore.getState().addNotification({
            pipelineId: 0,
            projectId: null,
            status: 'success',
            ref: payload.eventType ?? 'message',
            webUrl: 'agents',
            title: payload.title,
            message: payload.body,
            personaId: payload.personaId,
          });
        },
      );
      return [unlisten];
    },
  },
];

function tracing(...args: unknown[]) {
  logger.info(args.map(String).join(" "));
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

  // Register listeners in small batches to avoid flooding the IPC bridge.
  // See EVENT_BRIDGE_TIMING.INIT_BATCH_SIZE for the rationale.
  const BATCH_SIZE = EVENT_BRIDGE_TIMING.INIT_BATCH_SIZE;
  for (let i = 0; i < registry.length; i += BATCH_SIZE) {
    const batch = registry.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((reg) => reg.setup()),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        unlisteners.push(...result.value);
      } else {
        logger.error("Failed to attach listener", { reason: String(result.reason) });
      }
    }
  }

  // Kick off backend template integrity verification (defense-in-depth).
  // Deferred to idle time to avoid competing with startup IPC calls.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => {
      void import("@/lib/personas/templates/templateCatalog").then((m) =>
        m.verifyTemplatesWithBackend(),
      );
    });
  } else {
    setTimeout(() => {
      void import("@/lib/personas/templates/templateCatalog").then((m) =>
        m.verifyTemplatesWithBackend(),
      );
    }, EVENT_BRIDGE_TIMING.TEMPLATE_VERIFICATION_FALLBACK_MS);
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

/**
 * Test-only export: exposes the registry array so tests can assert that a
 * specific event name is registered without needing a live Tauri AppHandle.
 * Do NOT use in production code.
 */
export const _testRegistry = registry;
