/**
 * Everything the chat loads when it opens, or when the active thread changes.
 *
 * The transcript is the ACTIVE conversation's slice — switching threads swaps
 * the message list, while the brain/identity stay global.
 */

import { useEffect, useRef } from 'react';
import {
  companionListPendingApprovals,
  companionListProactiveMessages,
  companionListRecentMessages,
  type CompanionMessage,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from '../companionStore';
import { useChatCardHydration } from '../useChatCards';
import { useTurnSidecarHydration } from '../useTurnSidecars';

export function useAthenaChatHydration(args: {
  initialized: boolean;
  activeConversationId: string;
  messages: CompanionMessage[];
}): void {
  const { initialized, activeConversationId, messages } = args;

  useEffect(() => {
    if (!initialized) return;
    companionListRecentMessages(50, activeConversationId)
      .then((msgs) => {
        // The user may have switched threads while this was in flight.
        if (useCompanionStore.getState().activeConversationId === activeConversationId) {
          useCompanionStore.getState().setMessages(msgs);
        }
      })
      .catch(silentCatch('companion_list_recent_messages'));
  }, [initialized, activeConversationId]);

  // Replay the persisted per-turn side channels (trail / plan / summary /
  // recall) for the bubbles on screen, so a restart doesn't strip older turns
  // back to bare text.
  useTurnSidecarHydration(messages);

  // Re-hydrate this thread's PENDING actionable chat cards (fleet plans, ship
  // milestones). They are proposals the operator still owes an answer to, and
  // before they were durable a refresh destroyed them unrecoverably.
  useChatCardHydration(activeConversationId, initialized);

  // Approvals + proactive nudges are global, not per-thread — fetch once.
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!initialized || fetchedRef.current) return;
    fetchedRef.current = true;
    companionListPendingApprovals()
      .then((list) => useCompanionStore.getState().setApprovals(list))
      .catch(silentCatch('companion_list_pending_approvals'));
    // Phase E: surface unresolved nudges immediately on mount rather than only
    // after the next scheduler tick.
    companionListProactiveMessages(true, 20)
      .then((list) => useCompanionStore.getState().setProactive(list))
      .catch(silentCatch('companion_list_proactive_messages'));
  }, [initialized]);
}
