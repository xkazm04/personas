import { useCallback, useEffect } from 'react';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import {
  COMPANION_TURN_SUMMARY_EVENT,
  companionListConversations,
  companionMarkConversationRead,
  type CompanionTurnSummaryEvent,
} from '@/api/companion';
import { useCompanionStore } from './companionStore';

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
 * - Maintains the invariant that the thread the user is *viewing* is read: its
 *   unread is zeroed locally and persisted, so it never shows its own unread.
 */
export function useConversationRoster() {
  const setConversations = useCompanionStore((s) => s.setConversations);

  const refresh = useCallback(() => {
    companionListConversations()
      .then((rows) => {
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
      })
      .catch(silentCatch('companion_list_conversations'));
  }, [setConversations]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent<CompanionTurnSummaryEvent>(
    COMPANION_TURN_SUMMARY_EVENT,
    useCallback(() => refresh(), [refresh]),
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
