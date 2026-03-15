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
      const channel = new Channel<BuildEvent>();
      channel.onmessage = handleChannelMessage;

      // Invoke the Tauri command -- backend starts the CLI process
      const sessionId = await startBuildSession(
        channel,
        effectivePersonaId,
        intent,
        workflowJson,
        parserResultJson,
      );

      // Store refs
      channelRef.current = channel;
      sessionIdRef.current = sessionId;

      // Update the store
      useAgentStore.setState({ buildSessionId: sessionId });

      return sessionId;
    },
    [personaId, handleChannelMessage],
  );

  const answerQuestion = useCallback(
    async (cellKey: string, answer: string): Promise<void> => {
      if (!sessionIdRef.current) {
        throw new Error("[useBuildSession] No active session to answer");
      }

      await answerBuildQuestion(sessionIdRef.current, cellKey, answer);

      // Clear only the answered question from the pending array
      useAgentStore.getState().clearBuildQuestion(cellKey);
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
    if (!personaId) return;

    let cancelled = false;

    (async () => {
      const session = await getActiveBuildSession(personaId);
      if (cancelled) return;
      if (session) {
        useAgentStore.getState().hydrateBuildSession(session);
      }
    })();

    return () => {
      cancelled = true;
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
    cancelSession,
  };
}
