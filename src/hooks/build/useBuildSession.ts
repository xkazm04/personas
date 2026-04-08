/**
 * Build Session Hook -- Channel API Implementation
 *
 * SESS-03 Benchmark Results: Channel vs EventBridge for build session streaming
 *
 * Both approaches were implemented and tested in buildStreamBenchmark.test.ts.
 * The EventBridge variant was removed after benchmarking confirmed Channel as
 * the winner. Results:
 *
 * 1. ORDERING:
 *    - Channel: Guaranteed ordered delivery (point-to-point, sequential onmessage)
 *    - EventBridge: No ordering guarantee under rapid emission (each app.emit()
 *      independently evaluates JS, race conditions possible with 100+ events/frame)
 *    Winner: Channel
 *
 * 2. RECOVERY (primary criterion per CONTEXT.md):
 *    - Channel: Used for initial session only. On navigation away, Channel
 *      detaches and EventBridge (global Tauri listener) takes over seamlessly.
 *      On remount, SQLite checkpoint hydration restores missed state, while
 *      EventBridge continues delivering live events without interruption.
 *    - EventBridge: Global listener survives navigation, no gap.
 *    Result: Channel + EventBridge fallback provides gapless recovery.
 *
 * 3. THROUGHPUT:
 *    - Channel: Single handler path (onmessage -> pendingEventsRef -> RAF flush)
 *    - EventBridge: Double indirection (app.emit -> JS eval -> listen callback ->
 *      handler -> store). ~2x handler path length.
 *    Winner: Channel
 *
 * 4. TYPE SAFETY:
 *    - Channel: Compile-time generics (Channel<BuildEvent>)
 *    - EventBridge: Runtime type hint (listen<BuildEvent> is advisory only)
 *    Winner: Channel
 *
 * Decision: Channel selected (3 wins, 1 tie). EventBridge variant removed.
 * EventBridge remains appropriate for lifecycle broadcast events (session
 * started/completed) consumed by multiple UI components.
 *
 * Benchmark implementation: src/hooks/build/__tests__/buildStreamBenchmark.test.ts
 */

import { useCallback, useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { useAgentStore } from "@/stores/agentStore";
import { useI18nStore } from "@/stores/i18nStore";
import {
  startBuildSession,
  answerBuildQuestion,
  cancelBuildSession,
  getActiveBuildSession,
} from "@/api/agents/buildSession";
import type { BuildEvent } from "@/lib/types/buildTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("build-session");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseBuildSessionOptions {
  personaId: string | null;
}

interface UseBuildSessionReturn {
  startSession: (
    intent: string,
    overridePersonaId?: string,
    workflowJson?: string,
    parserResultJson?: string,
  ) => Promise<string>;
  answerQuestion: (cellKey: string, answer: string) => Promise<void>;
  submitAllAnswers: () => Promise<void>;
  cancelSession: () => Promise<void>;
  // State is read from useAgentStore selectors, not returned here
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBuildSession(
  options: UseBuildSessionOptions,
): UseBuildSessionReturn {
  const { personaId } = options;

  // -- Refs for batching and session tracking --------------------------------

  /** Accumulated events waiting for the next RAF flush. */
  const pendingEventsRef = useRef<BuildEvent[]>([]);

  /** Active requestAnimationFrame ID, or null if none pending. */
  const rafRef = useRef<number | null>(null);

  /** Current Channel instance. */
  const channelRef = useRef<Channel<BuildEvent> | null>(null);

  /** Active session ID for stale-event filtering. */
  const sessionIdRef = useRef<string | null>(null);

  // -- Event dispatch --------------------------------------------------------

  /**
   * Flush all pending events to the store. Each event is routed to the
   * correct slice handler based on its discriminant `type` field.
   *
   * Every handler is session-scoped: it uses `event.session_id` to look up
   * the target session in `buildSessions`. Events for sessions that don't
   * exist in the map are silently dropped by the handlers (updateSessionInState
   * returns a no-op patch when the session is missing). This means we can
   * stream events for multiple concurrent draft builds through the same
   * channel without cross-contamination, and we no longer need the
   * sessionIdRef-based stale-event filter that used to live here.
   */
  const flushEvents = useCallback(() => {
    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];

    const store = useAgentStore.getState();

    for (const event of events) {
      switch (event.type) {
        case "cell_update":
          store.handleBuildCellUpdate(event);
          break;
        case "question":
          store.handleBuildQuestion(event);
          break;
        case "progress":
          store.handleBuildProgress(event);
          break;
        case "error":
          store.handleBuildError(event);
          break;
        case "session_status":
          store.handleBuildSessionStatus(event);
          break;
      }
    }
  }, []);

  /**
   * Channel onmessage handler. Accumulates events and schedules a single
   * RAF to flush the batch -- 16ms cadence prevents render thrashing when
   * the CLI resolves multiple dimensions in rapid succession.
   */
  const handleChannelMessage = useCallback(
    (event: BuildEvent) => {
      pendingEventsRef.current.push(event);

      // Only schedule one RAF per frame
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          flushEvents();
        });
      }
    },
    [flushEvents],
  );

  // -- Session control functions --------------------------------------------

  const startSession = useCallback(
    async (
      intent: string,
      overridePersonaId?: string,
      workflowJson?: string,
      parserResultJson?: string,
    ): Promise<string> => {
      // If store was reset (e.g., Create new agent), clear stale refs
      if (!useAgentStore.getState().buildSessionId) {
        channelRef.current = null;
        sessionIdRef.current = null;
      }

      // Prevent double-start
      if (channelRef.current && sessionIdRef.current) {
        logger.warn("Session already active", { sessionId: sessionIdRef.current });
        return sessionIdRef.current;
      }

      const effectivePersonaId = overridePersonaId ?? personaId;
      if (!effectivePersonaId) {
        throw new Error("[useBuildSession] Cannot start session without personaId");
      }

      // Create typed Channel for streaming events
      // Flag prevents the global EventBridge from double-processing the same events
      (window as unknown as Record<string, unknown>).__BUILD_CHANNEL_ACTIVE__ = true;
      const channel = new Channel<BuildEvent>();
      channel.onmessage = handleChannelMessage;

      // Invoke the Tauri command -- backend starts the CLI process
      const language = useI18nStore.getState().language;
      const sessionId = await startBuildSession(
        channel,
        effectivePersonaId,
        intent,
        workflowJson,
        parserResultJson,
        language,
      );

      // Store refs
      channelRef.current = channel;
      sessionIdRef.current = sessionId;

      // Create a session slot in the buildSessions map and activate it.
      // Scalar fields (buildSessionId, buildPersonaId, etc.) are mirrored
      // automatically from the active session.
      useAgentStore.getState().createBuildSession(effectivePersonaId, sessionId);

      return sessionId;
    },
    [personaId, handleChannelMessage],
  );

  /**
   * Collect an answer locally without sending to CLI.
   * The user answers all pending questions, then clicks "Continue" to send.
   */
  const answerQuestion = useCallback(
    async (cellKey: string, answer: string): Promise<void> => {
      if (!sessionIdRef.current) {
        throw new Error("[useBuildSession] No active session to answer");
      }
      // Store answer locally — don't send to CLI yet
      useAgentStore.getState().collectAnswer(cellKey, answer);
    },
    [],
  );

  /**
   * Submit all collected answers to the CLI as a single batch.
   * Combines answers into one message so the CLI processes them in one turn.
   * Cells stay in 'resolved' state (confirmed by user) — no 'filling' spinner.
   */
  const submitAllAnswers = useCallback(
    async (): Promise<void> => {
      if (!sessionIdRef.current) {
        throw new Error("[useBuildSession] No active session");
      }
      const store = useAgentStore.getState();
      const answers = store.buildPendingAnswers;
      const entries = Object.entries(answers);
      if (entries.length === 0) return;

      // Build a combined answer that clearly lists each dimension's answer
      const combined = entries
        .map(([cellKey, answer]) => `[${cellKey}]: ${answer}`)
        .join('\n');

      // Use "_batch" as cellKey so the backend knows this is multi-dimension
      // The actual dimension keys are embedded in the answer text
      await answerBuildQuestion(sessionIdRef.current, "_batch", combined);
      store.clearPendingAnswers();
    },
    [],
  );

  const cancelSession = useCallback(async (): Promise<void> => {
    if (sessionIdRef.current) {
      await cancelBuildSession(sessionIdRef.current);
    }

    // Cancel any pending RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Clear refs
    channelRef.current = null;
    sessionIdRef.current = null;
    pendingEventsRef.current = [];

    // Reset the store slice
    useAgentStore.getState().resetBuildSession();
  }, []);

  // -- Hydration on mount ----------------------------------------------------

  useEffect(() => {
    // Derive effective persona ID: from prop, or from existing store state
    const currentStore = useAgentStore.getState();
    const effectivePersonaId = personaId ?? currentStore.buildPersonaId;

    if (!effectivePersonaId) return;

    let cancelled = false;

    (async () => {
      // Always hydrate from SQLite to pick up events that arrived while unmounted.
      // The EventBridge (global Tauri listener) handles live events when Channel
      // is not active, so we do NOT set __BUILD_CHANNEL_ACTIVE__ here — only
      // startSession sets it when a real Channel is created.
      const session = await getActiveBuildSession(effectivePersonaId);
      if (cancelled) return;

      if (session) {
        sessionIdRef.current = session.id;
        // hydrateBuildSession creates the buildSessions entry and activates it,
        // so buildPersonaId / buildSessionId / etc. are mirrored automatically.
        useAgentStore.getState().hydrateBuildSession(session);
      } else if (currentStore.buildSessionId && Object.keys(currentStore.buildCellStates).length > 0) {
        // No active session in DB but store has stale data — restore ref for UI consistency
        sessionIdRef.current = currentStore.buildSessionId;
      }
    })();

    return () => {
      cancelled = true;
      // Clear channel-active flag so EventBridge takes over for background events
      (window as unknown as Record<string, unknown>).__BUILD_CHANNEL_ACTIVE__ = false;
      // Cleanup: cancel any pending RAF on unmount
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [personaId]);

  // -- Return ----------------------------------------------------------------

  return {
    startSession,
    answerQuestion,
    submitAllAnswers,
    cancelSession,
  };
}
