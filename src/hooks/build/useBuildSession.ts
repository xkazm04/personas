/**
 * Build Session Hook -- Channel API Implementation
 *
 * SESS-03 Assessment: Channel vs EventBridge for build session streaming
 *
 * Channel (selected):
 * - Point-to-point, ordered delivery guaranteed
 * - Typed via generics (Channel<BuildEvent>)
 * - Auto-cleanup when Channel object is garbage collected
 * - Recovery: Channel is created per invoke() call. On navigation away,
 *   the Channel's onmessage callback is lost. Recovery requires calling
 *   getActiveBuildSession() to hydrate from SQLite checkpoint on return.
 *   Events emitted while away are NOT buffered -- they are lost, but the
 *   checkpoint has the latest resolved state.
 *
 * EventBridge (rejected for this use case):
 * - Broadcast to all listeners (wasteful for single-consumer stream)
 * - No ordering guarantee across rapid emissions
 * - Recovery: Can re-subscribe, but broadcast events emitted while
 *   unsubscribed are also lost. Same checkpoint-based recovery needed.
 * - Higher overhead: evaluates JS for each emission
 *
 * Decision: Channel wins. Both approaches lose events during navigation,
 * but Channel provides ordering and type safety. SQLite checkpoint-based
 * recovery handles the navigation case for both. EventBridge is kept for
 * session lifecycle events (started/completed) that other UI components
 * may need to observe (broadcast use case).
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
  startSession: (intent: string) => Promise<string>;
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
    async (intent: string): Promise<string> => {
      // Prevent double-start
      if (channelRef.current && sessionIdRef.current) {
        console.warn(
          "[useBuildSession] Session already active:",
          sessionIdRef.current,
        );
        return sessionIdRef.current;
      }

      if (!personaId) {
        throw new Error("[useBuildSession] Cannot start session without personaId");
      }

      // Create typed Channel for streaming events
      const channel = new Channel<BuildEvent>();
      channel.onmessage = handleChannelMessage;

      // Invoke the Tauri command -- backend starts the CLI process
      const sessionId = await startBuildSession(channel, personaId, intent);

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

      // Clear the pending question in the store
      useAgentStore.setState({ buildCurrentQuestion: null });
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
