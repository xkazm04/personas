/**
 * `companion://stream` — the turn lifecycle listener.
 *
 * One Tauri subscription drives everything that happens while Athena is
 * talking: per-conversation live-turn bookkeeping, the operational checklist,
 * the narration timeline, and the hand-off to the persisted transcript at
 * `finished`.
 *
 * Two invariants worth keeping in mind when editing:
 *
 *  - **Focus is read at EVENT time**, never from a render closure. The user can
 *    switch threads mid-turn, and only the focused thread may touch flat/visible
 *    state; per-conversation writes run for every thread.
 *  - **Backend-initiated turns own their own ending.** A `started` on a
 *    conversation that isn't already streaming came from the proactive scheduler
 *    or an autonomous continuation, so this listener (not `send`) ends it and
 *    refetches the transcript.
 */

import { useCallback, useRef } from 'react';
import {
  COMPANION_STREAM_EVENT,
  companionListRecentMessages,
  type CompanionStreamEvent,
} from '@/api/companion';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import { DEFAULT_CONVERSATION_ID, useCompanionStore } from '../companionStore';
import {
  extractAssistantText,
  extractAssistantTextDelta,
} from '../extractAssistantText';
import { extractStreamPhase, extractToolEvents } from '../extractStreamPhase';
import { extractTodoWrite } from '../operationalSteps';
import { persistTurnSidecar } from '../useTurnSidecars';
import { useAthenaChatDeltas } from './athenaChatDeltas';

export function useAthenaChatStream(args: {
  /** Updated on every focused-thread event — drives the slow-progress chip. */
  lastStreamEventAtRef: React.MutableRefObject<number>;
  /** Resets per-turn spoken-progress bookkeeping. */
  onTurnStarted: () => void;
}): void {
  const { lastStreamEventAtRef, onTurnStarted } = args;
  const deltas = useAthenaChatDeltas();

  // Conversations whose in-flight turn this client did NOT initiate.
  const backendTurnsRef = useRef<Set<string>>(new Set());

  useTauriEvent<CompanionStreamEvent>(
    COMPANION_STREAM_EVENT,
    useCallback(
      (event) => {
        const ev = event.payload;
        // The backend stamps the conversation id (`sessionId` on the wire) on
        // every stream event; old events without one target the default thread.
        const conv = ev.sessionId ?? DEFAULT_CONVERSATION_ID;
        const store = useCompanionStore.getState();
        const isActive = conv === store.activeConversationId;
        // Silence is what we surface as "still working", so every focused-thread
        // event resets the clock. Background threads have no visible bubble.
        if (isActive) lastStreamEventAtRef.current = Date.now();

        if (ev.kind === 'started') {
          if (!store.liveTurns[conv]?.streaming) backendTurnsRef.current.add(conv);
          store.beginLiveTurn(conv, ev.turnId);
          deltas.reset(conv);
          if (!isActive) return;
          // Flat/visible state below — a background thread must not clobber it.
          store.setStreamingRecall(null);
          store.setStreamingSteps([]);
          onTurnStarted();
          store.beginNarration();
          return;
        }

        if (ev.kind === 'cli') {
          // The narration timeline still accrues (it backs the dev conversation
          // log and the persisted turn sidecar) even though the chat no longer
          // renders it — Athena's tool calls are recorded, not displayed.
          if (isActive) {
            const toolEvents = extractToolEvents(ev.payload);
            for (const ts of toolEvents.started) {
              // TodoWrite has its own checklist UI — the checklist IS its
              // surface, so it never becomes a narration row.
              if (ts.name === 'TodoWrite') continue;
              store.appendNarrationEntry({
                id: ts.id,
                kind: 'tool',
                toolName: ts.name,
                detail: ts.detail,
                at: Date.now(),
              });
            }
            for (const doneId of toolEvents.finished) store.completeNarrationTool(doneId);
          }
          // A TodoWrite call republishes Athena's full plan (latest wins).
          const steps = extractTodoWrite(ev.payload);
          if (steps) {
            if (isActive) store.setStreamingSteps(steps);
            return;
          }
          const delta = extractAssistantTextDelta(ev.payload);
          if (delta) {
            // First token of the reply — flip the status once, not per token.
            if (!deltas.sawDeltas(conv)) {
              store.patchLiveTurn(conv, { streamingPhase: { kind: 'responding' } });
            }
            deltas.push(conv, delta);
            return;
          }
          // Whole-message path (also the only path on CLIs that don't emit
          // partial messages).
          const text = extractAssistantText(ev.payload);
          const phase = extractStreamPhase(ev.payload);
          if (text) {
            store.patchLiveTurn(conv, { streamingPhase: { kind: 'responding' } });
            // If deltas already streamed this turn, this text duplicates them.
            if (!deltas.sawDeltas(conv)) store.appendLiveText(conv, text);
          } else if (phase) {
            store.patchLiveTurn(conv, { streamingPhase: phase });
          }
          return;
        }

        if (ev.kind === 'finished') {
          // Land buffered deltas before the refetch swaps the streaming bubble
          // for the persisted episode.
          deltas.flush();
          deltas.reset(conv);
          if (isActive) {
            if (ev.payload) {
              // Promote the in-flight side channels onto the just-persisted
              // assistant episode so they pin under the completed bubble, then
              // persist them so they survive a restart. Fire-and-forget.
              store.attachRecallToEpisode(ev.payload);
              store.attachPendingJobsToEpisode(ev.payload);
              store.attachStepsToEpisode(ev.payload);
              store.attachNarrationToEpisode(ev.payload);
              persistTurnSidecar(ev.payload);
            } else {
              store.setStreamingRecall(null);
              store.resetStreamingNarration();
            }
            store.setStreamingSteps([]);
          }
          store.patchLiveTurn(conv, { streamingPhase: null, turnId: null });
          if (!backendTurnsRef.current.has(conv)) return;
          backendTurnsRef.current.delete(conv);
          store.endLiveTurn(conv);
          // A backend-owned reply is one the user never asked for and by
          // definition wasn't watching arrive — badge the orb. Deliberately NOT
          // inside `endLiveTurn`: the error path ends the turn too, and a failed
          // turn is not a message.
          store.noteIncomingReply();
          if (!isActive) return;
          companionListRecentMessages(50, conv)
            .then((msgs) => {
              // Re-check focus — the user may have switched mid-refetch.
              const live = useCompanionStore.getState();
              if (live.activeConversationId === conv) live.setMessages(msgs);
            })
            .catch(silentCatch('companion_list_recent_messages'));
          return;
        }

        if (ev.kind === 'error') {
          deltas.flush();
          deltas.reset(conv);
          if (isActive) {
            store.setSendError(ev.payload);
            store.setStreamingRecall(null);
            store.setStreamingSteps([]);
            store.resetStreamingNarration();
          }
          store.patchLiveTurn(conv, { streamingPhase: null, turnId: null });
          // No user-send `finally` runs for a backend turn — end it here so the
          // panel doesn't hang on a thinking bubble.
          if (backendTurnsRef.current.has(conv)) {
            backendTurnsRef.current.delete(conv);
            store.endLiveTurn(conv);
          }
        }
      },
      [deltas, lastStreamEventAtRef, onTurnStarted],
    ),
    'companion_stream_listen',
  );
}
