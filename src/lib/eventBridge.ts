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
import { silentCatch } from '@/lib/silentCatch';
import { getActiveTranslations } from "@/i18n/useTranslation";


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
   * Bulk batch size for non-critical listener registration. After the three
   * critical listeners (auth, persona, execution) are attached and a single
   * frame has been yielded for input responsiveness, the remaining listeners
   * register in batches this size. The original value of 5 was chosen
   * conservatively for early Tauri 1; modern Tauri 2 IPC handles wider batches
   * comfortably, so registering ~14 remaining listeners in a single bulk batch
   * trims 4 sequential round-trips down to 2. Halving regresses cold-start
   * latency; doubling produced no further measurable win in profiling.
   */
  INIT_BATCH_SIZE_BULK: 16,
  /**
   * Debounce for `TITLEBAR_NOTIFICATION`. Each persona dispatch is an independent
   * notification — no coalescing in v1.2 so the bell updates immediately on every message.
   * A future "grouping" feature would increase this. (DELIV-04)
   */
  TITLEBAR_NOTIFICATION_DEBOUNCE_MS: 0,
  /**
   * Exponential backoff schedule for retrying listener registrations that
   * rejected during the initial cold-start waves. Cold-start IPC hiccups
   * (Tauri main thread saturation, race with Rust state init) cause
   * intermittent `listen()` rejections; the original `Promise.allSettled`
   * loop logged and forgot them, leaving the UI partially wired with no
   * recovery path other than an app restart. Three retries spaced 0.5s →
   * 1.5s → 4.5s gives the backend ~6.5s of total recovery window without
   * gating cold-start latency (retries run async after both init waves).
   * Halving regresses recovery success rate; doubling delays the
   * "updates may be delayed" banner past the point users start noticing.
   */
  LISTENER_RETRY_DELAYS_MS: [500, 1500, 4500] as const,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventRegistration {
  /** Tauri event name (or "window:<name>" for DOM events). */
  event: string;
  /** Setup function that calls `listen()` and returns unlisten handles. */
  setup: () => Promise<UnlistenFn[]>;
  /**
   * "critical" listeners (auth, persona, execution) attach in the first wave
   * before yielding a frame; everything else attaches in the bulk wave.
   * Defaults to "normal" when omitted.
   */
  priority?: "critical" | "normal";
}

interface EventBridgeRuntime {
  attached: boolean;
  retryGeneration: { aborted: boolean };
  unlisteners: UnlistenFn[];
}

declare global {
  // Persist listener handles across Vite HMR module re-evaluation. The module
  // local `attached` flag resets under HMR, but Tauri listeners remain active
  // until their unlisten functions are called.
  var __personasEventBridge: EventBridgeRuntime | undefined;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const eventBridgeRuntime: EventBridgeRuntime =
  globalThis.__personasEventBridge ??= {
    attached: false,
    retryGeneration: { aborted: false },
    unlisteners: [],
  };

let attached = false;
const unlisteners = eventBridgeRuntime.unlisteners;

/**
 * Generation token for in-flight retry loops. `teardownAllListeners()` flips
 * `aborted` so any retry that was sleeping between attempts bails out cleanly
 * instead of pushing late unlisteners into a freshly cleared array (which
 * would survive teardown and leak across test isolations / HMR cycles).
 */
let retryGeneration = eventBridgeRuntime.retryGeneration;

type AttachOutcome =
  | { ok: true; reg: EventRegistration; unlisteners: UnlistenFn[] }
  | { ok: false; reg: EventRegistration; reason: unknown };

/**
 * Run a single registration's `setup()` and pair the result with its
 * `EventRegistration` so callers can iterate without index-shuffle fragility.
 * Avoids the `noUncheckedIndexedAccess` traps that come with running
 * `Promise.allSettled` over a parallel registrations array.
 */
async function tryAttach(reg: EventRegistration): Promise<AttachOutcome> {
  try {
    return { ok: true, reg, unlisteners: await reg.setup() };
  } catch (reason) {
    return { ok: false, reg, reason };
  }
}

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
    priority: "critical",
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

          // A-grade Phase 3 (2026-05-03): only require that the event's
          // session_id is in our buildSessions map. Pre-Phase-3 we filtered
          // by the scalar `buildSessionId` (which mirrors only the
          // currently-active session) — that silently dropped events for
          // backgrounded sessions even though the store already routes by
          // event.session_id via updateSessionInState. The result was
          // backgrounded builds appearing frozen until the user clicked
          // their sidebar entry to make them active again.
          if (!store.buildSessions[payload.session_id]) return;

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

  // -- Manual review resolved → "Learned" toast (Phase 2: visible learning) ---
  // Resolving a review silently writes a learned/decision/constraint memory; this
  // surfaces it so the feedback loop is visible ("the agent learned X"). Fires
  // only when a NEW memory was written (dedup-skips carry no `learned`).
  {
    event: EventName.MANUAL_REVIEW_RESOLVED,
    priority: "normal",
    setup: async () => {
      const unlisten = await typedListen(EventName.MANUAL_REVIEW_RESOLVED, (payload) => {
        const learned = payload.learned;
        if (!learned) return;
        const t = getActiveTranslations();
        const prefix =
          learned.category === "constraint"
            ? t.monitor.learned_constraint
            : learned.category === "decision"
              ? t.monitor.learned_decision
              : t.monitor.learned_generic;
        const title = learned.title.length > 90 ? `${learned.title.slice(0, 90)}…` : learned.title;
        // "View" → the Knowledge (memories) surface, where the learned memory is
        // listed and editable/deletable (Phase 2b — makes the lesson correctable).
        useToastStore.getState().addToast(`🧠 ${prefix} — ${title}`, "success", 6000, {
          label: t.monitor.learned_view,
          onClick: () => {
            useSystemStore.getState().setSidebarSection("overview");
            useOverviewStore.getState().setOverviewTab("knowledge");
          },
        });
      });
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
    priority: "critical",
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
            // Click handler in NotificationCenter looks up
            // `executionId` and, after navigating, writes it to
            // `pendingExecutionFocus` so GlobalExecutionList can pop the
            // ExecutionDetailModal for that specific run.
            redirectSection: "overview",
            // OverviewTab key for the Activity / Executions sub-tab —
            // matches the literal in `src/lib/types/types.ts::OverviewTab`
            // and the conditional in `OverviewPage.tsx:37`.
            redirectTab: "executions",
            executionId: execution_id,
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
          // Keep the FleetActivityStrip's capacity gauge honest: the queue
          // event carries the authoritative live global cap.
          if (typeof payload.global_capacity === "number" && payload.global_capacity > 0) {
            store.setMaxParallelExecutions(payload.global_capacity);
          }
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
          // The snapshot push from the Rust side carries authoritative state
          // for the snapshot endpoint, so it clears that endpoint's counter
          // (and any aggregate error if no other endpoint is also failing).
          // Other endpoints' counters are intentionally untouched — they
          // recover only when their own poller succeeds.
          pending = {
            networkStatus: payload.status,
            connectionHealth: payload.health,
            discoveredPeers: payload.discoveredPeers,
            messagingMetrics: payload.messagingMetrics,
            connectionMetrics: payload.connectionMetrics,
            manifestSyncMetrics: payload.manifestSyncMetrics,
            networkFailureCounts: {},
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
    priority: "critical",
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

  // -- Twin Training Studio batch progress / completion ---------------------
  // Registered globally so the sidebar progress dots (L1 plugins, L2 Twin,
  // L3 Training) stay accurate while the user navigates away during a
  // long-running batch. The OS notification on completion is fired
  // authoritatively by the Rust side, so this only settles in-app state.
  {
    event: EventName.TWIN_STUDIO_PROGRESS,
    setup: async () => {
      const unlisten = await typedListen(EventName.TWIN_STUDIO_PROGRESS, (payload) => {
        useSystemStore.getState().onStudioProgress(payload);
      });
      return [unlisten];
    },
  },
  {
    event: EventName.TWIN_STUDIO_COMPLETE,
    setup: async () => {
      const unlisten = await typedListen(EventName.TWIN_STUDIO_COMPLETE, (payload) => {
        useSystemStore.getState().onStudioComplete(payload);
      });
      return [unlisten];
    },
  },

  // -- One-shot build terminal phase (Promoted | Failed) --------------------
  // Fires when an autonomous build ends — adds an entry to the bell with a
  // deep-link to the persona so the user can review what landed (or why it
  // failed). The matching OS notification is fired by the Rust side via
  // `tauri-plugin-notification`; this listener only handles the in-app bell.
  {
    event: EventName.BUILD_ONESHOT_TERMINAL,
    setup: async () => {
      const unlisten = await typedListen(
        EventName.BUILD_ONESHOT_TERMINAL,
        (payload) => {
          const personaName = payload.personaName ?? 'Your draft';
          const title = payload.success
            ? `'${personaName}' is ready`
            : `'${personaName}' didn't land`;
          const message = payload.success
            ? 'One-shot build promoted. Open the persona to test or run it.'
            : payload.errorMessage
              ? `One-shot build failed: ${payload.errorMessage}`
              : 'One-shot build failed. Open the persona to inspect the draft.';

          useNotificationCenterStore.getState().addProcessNotification({
            processType: 'execution',
            personaId: payload.personaId,
            personaName,
            status: payload.success ? 'success' : 'failed',
            summary: message,
            redirectSection: 'agents',
            redirectTab: null,
          });
          // Also surface as a toast so the user sees feedback even if the
          // bell panel is collapsed.
          useToastStore.getState().addToast(title, payload.success ? 'success' : 'error');
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
 *
 * Cold-start strategy: critical listeners (auth, persona, execution) attach
 * first, then a single requestAnimationFrame yields back to the renderer so
 * input/first paint stays responsive, then the bulk wave runs in batches of
 * `INIT_BATCH_SIZE_BULK`. Performance marks bracket each wave so the timing
 * is visible in DevTools' Performance tab.
 */
export async function initAllListeners(): Promise<void> {
  if (attached) return;
  if (eventBridgeRuntime.attached || unlisteners.length > 0) {
    await teardownAllListeners();
  }
  attached = true;
  eventBridgeRuntime.attached = true;
  retryGeneration = { aborted: false };
  eventBridgeRuntime.retryGeneration = retryGeneration;
  const generation = retryGeneration;

  performance.mark("event-bridge:init:start");

  const failedRegistrations: EventRegistration[] = [];

  const attachBatch = async (batch: EventRegistration[]) => {
    const outcomes = await Promise.all(batch.map(tryAttach));
    for (const outcome of outcomes) {
      if (outcome.ok) {
        if (generation.aborted) {
          for (const fn of outcome.unlisteners) {
            try { fn(); } catch (err) { silentCatch("lib/eventBridge:catch1")(err); }
          }
          continue;
        }
        unlisteners.push(...outcome.unlisteners);
      } else {
        logger.error("Failed to attach listener", {
          event: outcome.reg.event,
          reason: String(outcome.reason),
        });
        failedRegistrations.push(outcome.reg);
      }
    }
  };

  // Wave 1: critical listeners (auth/persona/execution) — small set, attached
  // in parallel so first-paint state isn't gated on the bulk IPC traffic.
  const critical = registry.filter((r) => r.priority === "critical");
  const normal = registry.filter((r) => r.priority !== "critical");

  performance.mark("event-bridge:init:critical:start");
  await attachBatch(critical);
  performance.mark("event-bridge:init:critical:end");
  performance.measure(
    "event-bridge:init:critical",
    "event-bridge:init:critical:start",
    "event-bridge:init:critical:end",
  );

  // Yield one frame so the renderer can paint and accept input before we
  // submit the bulk IPC traffic.
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  // Wave 2: bulk register the remaining listeners. Modern Tauri 2 IPC handles
  // batches in the 15-20 range without the jank that motivated the original
  // size-5 cap on Tauri 1.
  performance.mark("event-bridge:init:bulk:start");
  const bulkSize = EVENT_BRIDGE_TIMING.INIT_BATCH_SIZE_BULK;
  const bulkBatches: EventRegistration[][] = [];
  for (let i = 0; i < normal.length; i += bulkSize) {
    bulkBatches.push(normal.slice(i, i + bulkSize));
  }
  await Promise.all(bulkBatches.map(attachBatch));
  performance.mark("event-bridge:init:bulk:end");
  performance.measure(
    "event-bridge:init:bulk",
    "event-bridge:init:bulk:start",
    "event-bridge:init:bulk:end",
  );

  performance.mark("event-bridge:init:end");
  performance.measure(
    "event-bridge:init",
    "event-bridge:init:start",
    "event-bridge:init:end",
  );

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

  // Async recovery for any registrations that rejected during the cold-start
  // waves. Runs detached so the caller's await of `initAllListeners()` resolves
  // as soon as the first-pass attachment is done — partial wiring is preferable
  // to making startup wait on flaky IPC retries.
  if (failedRegistrations.length > 0) {
    void retryFailedRegistrations(failedRegistrations, generation);
  }
}

/**
 * Retry registrations that rejected during the initial waves. Surfaces a
 * single user-facing toast if any listener is still unattached after the
 * retry budget is exhausted — the alternative (silent partial wiring) leaves
 * users staring at stale spinners with no recoverable hint other than a
 * full app restart.
 */
async function retryFailedRegistrations(
  failed: EventRegistration[],
  generation: { aborted: boolean },
): Promise<void> {
  const delays = EVENT_BRIDGE_TIMING.LISTENER_RETRY_DELAYS_MS;
  let pending = failed;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (generation.aborted || pending.length === 0) return;

    const delay = delays[attempt] ?? 0;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (generation.aborted) return;

    const outcomes = await Promise.all(pending.map(tryAttach));
    const stillFailed: EventRegistration[] = [];
    for (const outcome of outcomes) {
      if (outcome.ok) {
        if (generation.aborted) {
          // Teardown happened mid-flight; immediately detach the unlisteners
          // we just produced rather than leaking them past the next init.
          for (const fn of outcome.unlisteners) {
            try { fn(); } catch (err) { silentCatch("lib/eventBridge:catch2")(err); }
          }
        } else {
          unlisteners.push(...outcome.unlisteners);
          logger.info("Listener attached on retry", {
            event: outcome.reg.event,
            attempt: attempt + 1,
          });
        }
      } else {
        logger.warn("Listener retry failed", {
          event: outcome.reg.event,
          attempt: attempt + 1,
          reason: String(outcome.reason),
        });
        stillFailed.push(outcome.reg);
      }
    }
    pending = stillFailed;
  }

  if (generation.aborted || pending.length === 0) return;

  const eventNames = pending.map((r) => r.event).join(", ");
  logger.error("Listeners permanently failed to attach after retries", { events: eventNames });
  // Non-blocking error toast: the app remains usable, but real-time updates
  // tied to the failed channels (build progress, notifications, etc.) won't
  // arrive without a restart. Telling the user is strictly better than the
  // pre-fix behavior of permanently-stuck UI with no diagnostic.
  useToastStore.getState().addToast(
    "Some real-time updates may be delayed. Restart the app if data appears stale.",
    "error",
    8000,
  );
}

/**
 * Detach all listeners previously attached by `initAllListeners()`.
 * Useful for tests, hot-reload, and app shutdown.
 */
export async function teardownAllListeners(): Promise<void> {
  // Abort any in-flight retry loops before clearing state — otherwise a
  // sleeping retry could push fresh unlisteners into the array we're about
  // to drop, leaking them past the teardown boundary.
  retryGeneration.aborted = true;
  eventBridgeRuntime.retryGeneration.aborted = true;
  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch (err) { silentCatch("lib/eventBridge:catch3")(err); }
  }
  unlisteners.length = 0;
  attached = false;
  eventBridgeRuntime.attached = false;
}

/**
 * Test-only export: exposes the registry array so tests can assert that a
 * specific event name is registered without needing a live Tauri AppHandle.
 * Do NOT use in production code.
 */
export const _testRegistry = registry;
