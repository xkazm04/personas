import { useCallback, useEffect } from 'react';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
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
 *   Athena/Notices thread, whose proactive popover owns its own notice), it
 *   raises a **named, jumpable orb notice** ("Athena replied in <thread>") so
 *   the user can tell WHICH conversation replied and jump to it in one click —
 *   the visual counterpart to the audio, which only ever speaks the focused
 *   thread (see docs/features/companion/README.md, "Telling threads apart").
 * - Maintains the invariant that the thread the user is *viewing* is read: its
 *   unread is zeroed locally and persisted, so it never shows its own unread.
 */
export function useConversationRoster() {
  const { t, tx } = useTranslation();
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
            // Only surface a "which thread?" cue for a background reply — the
            // thread you're viewing needs none, and the Notices thread has its
            // own richer proactive popover.
            if (
              !completedId ||
              completedId === active ||
              completedId === NOTICES_CONVERSATION_ID
            ) {
              return;
            }
            const thread = rows.find((r) => r.id === completedId);
            if (!thread || thread.unreadCount <= 0n) return;
            useCompanionStore.getState().setFooterNotice({
              id: `thread_${completedId}_${event.payload.turnId ?? ''}`,
              kind: 'proactive',
              subject: tx(t.plugins.companion.replied_in_thread, {
                thread: thread.title ?? '—',
              }),
              ttsSpoken: false,
              createdAt: Date.now(),
              conversationId: completedId,
            });
          })
          .catch(silentCatch('companion_list_conversations'));
      },
      [refresh, t, tx],
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
