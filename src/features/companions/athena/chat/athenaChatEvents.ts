/**
 * Turn side-channel listeners — everything the backend pushes at the chat that
 * isn't the token stream itself: recall previews, turn summaries, background
 * jobs, inline chat cards, proactive nudges, and approval creations.
 *
 * All of these write straight to the store, so the hook renders nothing and
 * returns nothing; it exists to keep the subscriptions in one readable place.
 */

import { useCallback } from 'react';
import {
  COMPANION_APPROVALS_EVENT,
  COMPANION_CHAT_CARDS_EVENT,
  COMPANION_JOB_EVENT,
  COMPANION_PROACTIVE_EVENT,
  COMPANION_RECALL_PREVIEW_EVENT,
  COMPANION_TURN_SUMMARY_EVENT,
  companionListPendingApprovals,
  type BackgroundJob,
  type CompanionChatCardsEvent,
  type CompanionRecallPreviewEvent,
  type CompanionTurnSummaryEvent,
  type CreatedApproval,
  type ProactiveDeliveryEvent,
} from '@/api/companion';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import { isActionableChatCard, useCompanionStore } from '../companionStore';
import { persistTurnSidecar } from '../useTurnSidecars';

export function useAthenaChatEvents(): void {
  // Recall preview: fires once per turn between `started` and the first CLI
  // delta, carrying what the brain pulled into the system prompt. Promoted onto
  // the assistant episode at `finished` time.
  useTauriEvent<CompanionRecallPreviewEvent>(
    COMPANION_RECALL_PREVIEW_EVENT,
    useCallback((event) => {
      const preview = event.payload?.preview;
      if (!preview) return;
      useCompanionStore.getState().setStreamingRecall(preview);
    }, []),
    'companion_recall_preview_listen',
  );

  // Turn summary: fires after the dispatcher block, already keyed by the
  // persisted assistant episode id.
  useTauriEvent<CompanionTurnSummaryEvent>(
    COMPANION_TURN_SUMMARY_EVENT,
    useCallback((event) => {
      const ev = event.payload;
      if (!ev?.assistantEpisodeId) return;
      // Drop the correlator fields the chip doesn't need.
      const { sessionId: _sid, turnId: _tid, assistantEpisodeId, ...summary } = ev;
      void _sid;
      void _tid;
      useCompanionStore.getState().setTurnSummary(assistantEpisodeId, summary);
      // Second write moment for the same sidecar row — the summary can land
      // after `finished`. The upsert COALESCEs, so this layers the summary on
      // without clobbering the trail/plan/recall.
      persistTurnSidecar(assistantEpisodeId);
    }, []),
    'companion_turn_summary_listen',
  );

  // Background jobs: every queued→running→completed/failed transition for any
  // kind. `upsertJob` decides which ones become inline cards — only
  // `connector_use` does; other kinds have their own UIs.
  useTauriEvent<BackgroundJob>(
    COMPANION_JOB_EVENT,
    useCallback((event) => {
      const job = event.payload;
      if (!job?.id) return;
      useCompanionStore.getState().upsertJob(job);
    }, []),
    'companion_job_listen',
  );

  // Inline chat cards. INFORMATIONAL kinds are one-shot (cleared on the next
  // send); ACTIONABLE kinds arrive with a durable id and are preserved until
  // the operator resolves them, so arriving cards layer ON TOP of pending
  // proposals rather than replacing the array.
  useTauriEvent<CompanionChatCardsEvent>(
    COMPANION_CHAT_CARDS_EVENT,
    useCallback((event) => {
      const cards = event.payload?.cards;
      if (!cards || cards.length === 0) return;
      const store = useCompanionStore.getState();
      const arriving = new Set(cards.map((c) => c.id).filter(Boolean));
      const kept = store.chatCards.filter(
        (c) => isActionableChatCard(c) && !arriving.has(c.id),
      );
      store.setChatCards([...kept, ...cards]);
    }, []),
    'companion_chat_cards_listen',
  );

  // Proactive deliveries from the scheduler. Dedupe by id is enforced in the
  // store, so appending blind is safe.
  useTauriEvent<ProactiveDeliveryEvent>(
    COMPANION_PROACTIVE_EVENT,
    useCallback((event) => {
      const { appendProactive } = useCompanionStore.getState();
      for (const m of event.payload.messages) appendProactive(m);
    }, []),
    'companion_proactive_listen',
  );

  // Approval creations. The payload carries the turn's new approvals, but we
  // refetch the canonical pending list instead — that also catches an approval
  // finalized in a different surface mid-stream.
  useTauriEvent<CreatedApproval[]>(
    COMPANION_APPROVALS_EVENT,
    useCallback(() => {
      companionListPendingApprovals()
        .then((list) => useCompanionStore.getState().setApprovals(list))
        .catch(silentCatch('companion_list_pending_approvals'));
    }, []),
    'companion_approvals_listen',
  );
}
