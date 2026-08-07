/**
 * The send pipeline — one user message in, one committed turn out.
 *
 * Every lifecycle write targets the conversation focused AT SEND TIME, pinned
 * in a local, because the user can switch threads while the turn runs.
 *
 * The non-blocking front door (interrupt-vs-queue for mid-turn typing) lives in
 * `athenaChatQueue.ts`; this file is the turn itself.
 */

import { useCallback, useRef } from 'react';
import {
  companionInterruptTurn,
  companionListRecentMessages,
  companionSendMessage,
} from '@/api/companion';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { createSendNonce, hasAcceptedNonce, recordAcceptedNonce } from '../sendNonceLedger';
import { lastAssistantText } from './athenaChatPreview';
import type { AthenaChatVoice } from './athenaChatVoice';

export interface AthenaChatSend {
  /** Direct send — quick replies, refine chips, retry, hero picks, triggers. */
  send: (text: string, nonce?: string) => void;
  /** A turn is starting or running in THIS client, ahead of the store flip. */
  isSending: () => boolean;
  /** Stop the ACTIVE conversation's in-flight turn. */
  interrupt: () => void;
}

export function useAthenaChatSend(args: {
  voice: AthenaChatVoice;
  lastStreamEventAtRef: React.MutableRefObject<number>;
}): AthenaChatSend {
  const { voice, lastStreamEventAtRef } = args;
  const { voiceActive, resetTurnProgress, playSpokenReply } = voice;

  const recallSynthesisEnabled = useSystemStore((s) => s.companionRecallSynthesisEnabled);
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);

  // Synchronous re-entrancy guard. The streaming flip updates the store
  // synchronously, but a `streaming` value captured in a render closure stays
  // stale until React re-renders — so two sends dispatched in the same tick can
  // both pass a `!streaming` gate and double-fire a turn. This ref flips the
  // instant a send starts, before any await.
  const sendingRef = useRef(false);

  const sendAsync = useCallback(
    async (text: string, nonce?: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      // Idempotency: dedupe on the client-generated nonce (NOT message text)
      // against a localStorage-backed ledger, so a replay after a restart is
      // dropped too. Internal call sites without a nonce mint one — nothing
      // upstream could replay those.
      const sendNonce = nonce ?? createSendNonce();
      if (hasAcceptedNonce(sendNonce)) return;
      recordAcceptedNonce(sendNonce);
      sendingRef.current = true;

      const store = useCompanionStore.getState();
      const conversationId = store.activeConversationId;
      store.setSendError(null);
      // Quick replies + INFORMATIONAL chat cards are one-shot. Pending
      // ACTIONABLE proposals (fleet_plan / ship_milestone) survive: they are
      // decisions the operator still owes an answer to, and wiping them here is
      // what silently killed six dispatched builds in Aug 2026.
      store.setQuickReplies([]);
      store.clearTransientChatCards();
      store.appendMessage({
        id: `optim_${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      });
      // Raise this conversation's streaming flag BEFORE the IPC round-trip so
      // the `started` handler can tell a client-owned turn from a backend one.
      store.patchLiveTurn(conversationId, {
        streaming: true,
        streamingText: '',
        streamingBeat: null,
      });
      resetTurnProgress();
      // Seed the silence clock so the slow-progress chip doesn't trip on a
      // stale prior-turn timestamp.
      lastStreamEventAtRef.current = Date.now();

      try {
        const result = await companionSendMessage(
          trimmed,
          voiceActive,
          recallSynthesisEnabled,
          autonomousMode,
          undefined,
          conversationId,
        );
        // The assistant turn is committed. Badge the orb — a send can start from
        // the orb's quick-input bar with the panel closed. (No-op while the
        // panel is open; the store owns that rule.)
        useCompanionStore.getState().noteIncomingReply();
        const fresh = await companionListRecentMessages(50, conversationId);
        // Give the badge its words. Separate from the count above on purpose:
        // the count must survive a refetch that fails, and the preview is only
        // available once the canonical transcript lands.
        const preview = lastAssistantText(fresh);
        if (preview) useCompanionStore.getState().setUnreadPreview(preview);
        const live = useCompanionStore.getState();
        if (live.activeConversationId === conversationId) {
          live.setMessages(fresh);
          if (result.quickReplies?.length) live.setQuickReplies(result.quickReplies);
        }
        if (voiceActive && result.ttsText) {
          // Stash for the footer Play button FIRST — the progress channel treats
          // a set `pendingPlayback` as "the real answer is coming, stand down".
          useCompanionStore.getState().setPendingPlayback({
            episodeId: result.assistantEpisodeId,
            ttsText: result.ttsText,
            played: false,
            audioUrl: null,
          });
          playSpokenReply(result.ttsText);
        }
      } catch (err: unknown) {
        // extractMessage keeps "[object Object]" out of the error chip when the
        // IPC rejection is a Tauri envelope rather than an Error.
        useCompanionStore.getState().setSendError(extractMessage(err));
        silentCatch('companion_send_message')(err);
      } finally {
        // Order matters for the streaming bubble's exit animation: unmount it
        // (streaming:false) before clearing the scratch fields, or it briefly
        // renders an empty body mid-exit. Both patches target the SEND-TIME
        // conversation, never whatever thread is focused now.
        const s = useCompanionStore.getState();
        s.patchLiveTurn(conversationId, { streaming: false, turnId: null });
        // The IPC-rejection path never reaches the stream channel, so the
        // `finished`/`error` handlers that normally reset these don't run.
        s.patchLiveTurn(conversationId, {
          streamingText: '',
          streamingPhase: null,
          streamingBeat: null,
        });
        sendingRef.current = false;
      }
    },
    [
      voiceActive,
      recallSynthesisEnabled,
      autonomousMode,
      resetTurnProgress,
      playSpokenReply,
      lastStreamEventAtRef,
    ],
  );

  const send = useCallback(
    (text: string, nonce?: string) => void sendAsync(text, nonce),
    [sendAsync],
  );

  const isSending = useCallback(() => sendingRef.current, []);

  const interrupt = useCallback(() => {
    // The Stop control visually belongs to the focused thread, so it must never
    // kill a background thread's stream.
    const s = useCompanionStore.getState();
    const conversationId = s.activeConversationId;
    const turnId = s.liveTurns[conversationId]?.turnId ?? null;
    if (!turnId) return;
    // Optimistically clear so a second click can't double-fire while the backend
    // finalizes the partial reply.
    s.patchLiveTurn(conversationId, { turnId: null });
    companionInterruptTurn(turnId).catch(silentCatch('companion_interrupt_turn'));
  }, []);

  return { send, isSending, interrupt };
}
