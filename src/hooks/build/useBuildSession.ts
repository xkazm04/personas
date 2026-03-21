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
 *    - Channel: Events lost during navigation (onmessage callback detached).
 *      Recovery via getActiveBuildSession() hydrating from SQLite checkpoint.
 *    - EventBridge: Events lost during navigation (listener unsubscribed).
 *      Recovery via same SQLite checkpoint hydration.
 *    Result: TIE -- both require checkpoint-based recovery. Neither buffers.
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
   * Events whose session_id does not match the current session are silently
   * dropped to prevent cross-session interference.
   */
  const flushEvents = useCallback(() => {
    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];

    const store = useAgentStore.getState();

    for (const event of events) {
      // Stale-event guard: only process events for the active session
      if (event.session_id !== sessionIdRef.current) {
        continue;
      }

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
        console.warn(
          "[useBuildSession] Session already active:",
          sessionIdRef.current,
        );
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

      // Update the store
      useAgentStore.setState({ buildSessionId: sessionId, buildPersonaId: effectivePersonaId });

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
      // Skip hydration if the store already has a valid session with cell data
      // (happens when navigating away and back — Zustand state survives but Channel detached)
      if (currentStore.buildSessionId && Object.keys(currentStore.buildCellStates).length > 0) {
        // Restore sessionIdRef so answerQuestion can reach the backend
        sessionIdRef.current = currentStore.buildSessionId;
        (window as unknown as Record<string, unknown>).__BUILD_CHANNEL_ACTIVE__ = true;
        // Ensure buildPersonaId is set (may be null if component unmounted and remounted)
        if (!currentStore.buildPersonaId) {
          useAgentStore.setState({ buildPersonaId: effectivePersonaId });
        }
        return;
      }

      const session = await getActiveBuildSession(effectivePersonaId);
      if (cancelled) return;
      if (session) {
        sessionIdRef.current = session.id;
        (window as unknown as Record<string, unknown>).__BUILD_CHANNEL_ACTIVE__ = true;
        useAgentStore.getState().hydrateBuildSession(session);
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
