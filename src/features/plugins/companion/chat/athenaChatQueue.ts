/**
 * Non-blocking send — what happens when you type while Athena is still talking.
 *
 * Async-UX phase 4: the composer is deliberately never disabled. A message
 * typed mid-turn is classified (`classifyMidTurnIntent`) and either INTERRUPTS
 * the running turn (a redirect, or a plain "stop") or QUEUES behind it
 * (additive or ambiguous). One queued message drains per turn completion, so
 * FIFO order holds without colliding with the autonomous-continuation chain.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useCompanionStore } from '../companionStore';
import { classifyMidTurnIntent } from '../midTurnIntent';

export function useAthenaChatQueue(args: {
  streaming: boolean;
  activeConversationId: string;
  send: (text: string, nonce?: string) => void;
  isSending: () => boolean;
  interrupt: () => void;
}): (text: string, nonce: string) => void {
  const { streaming, activeConversationId, send, isSending, interrupt } = args;

  const sendOrQueue = useCallback(
    (text: string, nonce: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Gate on the LIVE store value (+ the in-flight ref), not a render
      // closure: the closure lags a render behind the streaming flip, so two
      // sends in one tick would both take the direct-send branch.
      const s = useCompanionStore.getState();
      if (!s.streaming && !isSending()) {
        send(trimmed, nonce);
        return;
      }
      const mode = classifyMidTurnIntent(trimmed);
      // Queue on the focused thread — the drain below shifts from this same
      // thread's queue when ITS turn completes. The nonce rides along so the
      // eventual drained send dedupes on the key the intent was minted with.
      s.enqueueMessage(s.activeConversationId, trimmed, mode, nonce);
      // A redirect stops the current turn now; the drain fires the queued
      // message the instant `streaming` flips false.
      if (mode === 'interrupt') interrupt();
    },
    [send, isSending, interrupt],
  );

  // Drain one message per turn completion, watching the streaming true→false
  // edge on the focused thread. `send` sets streaming back to true, so this
  // fires at most once per completed turn. Switching from a streaming thread to
  // an idle one also flips the mirror false — the same-thread guard makes that
  // a view change, not a completion.
  const prevStreamingRef = useRef(streaming);
  const prevActiveRef = useRef(activeConversationId);
  useEffect(() => {
    const was = prevStreamingRef.current;
    const wasConversation = prevActiveRef.current;
    prevStreamingRef.current = streaming;
    prevActiveRef.current = activeConversationId;
    if (was && !streaming && wasConversation === activeConversationId) {
      const next = useCompanionStore.getState().shiftQueuedMessage(activeConversationId);
      if (next) send(next.text, next.nonce);
    }
  }, [streaming, activeConversationId, send]);

  return sendOrQueue;
}
