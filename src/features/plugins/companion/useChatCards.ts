import { useEffect } from 'react';
import {
  companionListChatCards,
  companionResolveChatCard,
  type ChatCard,
  type ChatCardStatus,
  type CompanionChatCardRow,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from './companionStore';

/**
 * Durable chat-cards — the read/write bridge.
 *
 * Actionable cards (`fleet_plan`, `ship_milestone`) are proposals the operator
 * is expected to confirm, and their plan JSON is stripped from the assistant
 * text before episode persistence. While they lived only in the transient
 * Zustand array, a dev refresh (or the next send) destroyed them with no way
 * back — an Aug 2026 session lost six dispatched builds that way.
 *
 * Now the backend writes a `companion_chat_card` row before emitting the card,
 * and this module reads pending rows back on mount / conversation switch and
 * writes resolutions through.
 */

/** Turn a durable row into the in-transcript card shape. */
export function rowToCard(row: CompanionChatCardRow): ChatCard {
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.configJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed blob degrades to an empty config — the card still renders
    // its shell (and can be dismissed) instead of taking the panel down.
    config = {};
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? undefined,
    config,
    restored: true,
  };
}

/**
 * Merge the conversation's pending actionable cards into the transcript on
 * mount and on every conversation switch. Live cards win on id collision —
 * one already on screen carries fresher local edits than its stored row.
 */
export function useChatCardHydration(
  conversationId: string,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !conversationId) return;
    let cancelled = false;
    companionListChatCards(conversationId, true)
      .then((rows) => {
        if (cancelled) return;
        // Guard against a switch that landed while the fetch was in flight —
        // hydrating thread A's proposals into thread B would be worse than
        // not hydrating at all.
        if (useCompanionStore.getState().activeConversationId !== conversationId) return;
        useCompanionStore.getState().hydrateChatCards(rows.map(rowToCard));
      })
      .catch(silentCatch('companion_list_chat_cards'));
    return () => {
      cancelled = true;
    };
  }, [conversationId, enabled]);
}

/**
 * Resolve a card: patch the local entry, then write the status through. The
 * local update is applied first so the UI never waits on IPC; a failed write
 * is a background error (the row stays pending and re-hydrates next mount,
 * which is the safe direction for a proposal).
 */
export function resolveChatCard(
  id: string | undefined,
  status: Exclude<ChatCardStatus, 'pending'>,
  patch?: Record<string, unknown>,
  resultJson?: string,
): void {
  if (!id) return;
  const store = useCompanionStore.getState();
  if (status === 'dismissed' || status === 'superseded') {
    store.removeChatCard(id);
  } else if (patch) {
    store.patchChatCardConfig(id, patch);
  }
  companionResolveChatCard(id, status, resultJson ?? null).catch(
    silentCatch('companion_resolve_chat_card'),
  );
}
