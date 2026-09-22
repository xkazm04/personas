import { useCallback, useEffect } from 'react';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import {
  COMPANION_TURN_SUMMARY_EVENT,
  companionListConversations,
  companionMarkConversationRead,
  type CompanionTurnSummaryEvent,
} from '@/api/companion';
import type { ConversationRow } from '@/lib/bindings/ConversationRow';
import { NOTICES_CONVERSATION_ID, useCompanionStore } from './companionStore';

/**
 * Keeps the multi-conversation roster live. Mounted once from the always-present
 * footer orb (`CompanionFooterIcon`) so unread counts stay fresh even when the
 * chat panel is closed.
 *
 * - Hydrates `conversations` on mount.
 * - Refetches on every `companion://turn-summary` — which `send_turn` emits for
 *   EVERY turn, including background/proactive ones. So a thread the user isn't
 *   viewing that finishes a turn bumps its switcher + orb badge without being
 *   opened (design §5 "background-thread replies don't hijack you").
 * - When that finishing thread is one the user ISN'T viewing (and isn't the
 *   Athena/Notices thread, whose proactive cards own their own surface), it
 *   pulses the **orb's message reaction** — orb state only. It used to raise a
 *   named footer popover; that third communication dimension is gone. WHICH
 *   thread replied is carried by the thread attention badge and the in-chat
 *   conversation switcher (see docs/features/companion/README.md, "Telling
 *   threads apart").
 * - Maintains the invariant that the thread the user is *viewing* is read: its
 *   unread is zeroed locally and persisted, so it never shows its own unread.
 */
export function useConversationRoster() {
  const setConversations = useCompanionStore((s) => s.setConversations);

  const refresh = useCallback(async (): Promise<ConversationRow[]> => {
    const rows = await companionListConversations();
    const active = useCompanionStore.getState().activeConversationId;
    const normalized = rows.map((r) =>
      r.id === active ? { ...r, unreadCount: 0n } : r,
    );
    setConversations(normalized);
    // Persist the read if the backend still counted the active thread unread
    // (e.g. its own reply just landed while the user was looking at it).
    if (rows.some((r) => r.id === active && r.unreadCount > 0n)) {
      companionMarkConversationRead(active).catch(
        silentCatch('companion_mark_conversation_read'),
      );
    }
    return normalized;
  }, [setConversations]);

  useEffect(() => {
    refresh().catch(silentCatch('companion_list_conversations'));
  }, [refresh]);

  useTauriEvent<CompanionTurnSummaryEvent>(
    COMPANION_TURN_SUMMARY_EVENT,
    useCallback(
      (event) => {
        const completedId = event.payload?.sessionId;
        refresh()
          .then((rows) => {
            const active = useCompanionStore.getState().activeConversationId;
            // Only react for a BACKGROUND reply — the thread you're viewing
            // needs no cue, and the Notices thread has its own proactive cards.
            if (
              !completedId ||
              completedId === active ||
              completedId === NOTICES_CONVERSATION_ID
            ) {
              return;
            }
            const thread = rows.find((r) => r.id === completedId);
            if (!thread || thread.unreadCount <= 0n) return;
            // ORB STATE ONLY. This used to mint a footer-notice popover naming
            // the thread — a third communication dimension, now deleted. The
            // orb plays its one-shot message reaction so the user sees Athena
            // react; WHICH thread (and its words) is carried by the thread
            // attention badge + the conversation switcher inside chat, which is
            // the full-information dimension.
            useCompanionStore.getState().pulseMessageReaction();
          })
          .catch(silentCatch('companion_list_conversations'));
      },
      [refresh],
    ),
    'companion_roster_turn_summary',
  );
}

/** Number of OTHER threads awaiting the user (unread > 0). The active thread is
 *  kept read, so this naturally excludes it. Drives the orb attention badge. */
export function useThreadAttentionCount(): number {
  return useCompanionStore(
    (s) => s.conversations.filter((c) => c.unreadCount > 0n).length,
  );
}
