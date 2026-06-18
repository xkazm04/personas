import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("messages");
import type { PersonaMessage } from "@/lib/types/types";
import { deleteMessage, getMessageCount, getUnreadMessageCount, listMessages, markAllMessagesRead, markMessageRead, getBulkDeliverySummaries } from "@/api/overview/messages";
import type { MessageDeliverySummary } from "@/lib/bindings/MessageDeliverySummary";
import { deduplicateFetch } from "@/lib/utils/deduplicateFetch";
import { silentCatch } from '@/lib/silentCatch';



export interface MessageSlice {
  // State
  messages: PersonaMessage[];
  messagesTotal: number;
  unreadMessageCount: number;
  /** IDs of messages with in-flight markAsRead calls (not yet confirmed by backend). */
  _pendingReadIds: Set<string>;
  /** Delivery status summaries keyed by message ID. */
  deliverySummaries: Map<string, MessageDeliverySummary>;

  // Actions
  fetchMessages: (reset?: boolean) => Promise<void>;
  markMessageAsRead: (id: string) => Promise<void>;
  markAllMessagesAsRead: (personaId?: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  fetchUnreadMessageCount: () => Promise<void>;
  fetchDeliverySummaries: (messageIds: string[]) => Promise<void>;
}

export const createMessageSlice: StateCreator<OverviewStore, [], [], MessageSlice> = (set, get) => ({
  messages: [],
  messagesTotal: 0,
  unreadMessageCount: 0,
  _pendingReadIds: new Set(),
  deliverySummaries: new Map(),

  fetchMessages: async (reset = true) => {
    try {
      const PAGE_SIZE = 50;
      const offset = reset ? 0 : get().messages.length;
      const [rawMessages, totalCount, unreadCount] = await Promise.all([
        listMessages(PAGE_SIZE, offset),
        reset ? getMessageCount() : Promise.resolve(get().messagesTotal),
        getUnreadMessageCount(),
      ]);
      if (reset) {
        // Reset replaces the whole list, so the in-flight-read guard must be
        // cleared too — a leftover id (in-flight mark that never settled, or a
        // recycled id) would otherwise permanently no-op markMessageAsRead for it.
        set({ messages: rawMessages, messagesTotal: totalCount, unreadMessageCount: unreadCount, _pendingReadIds: new Set() });
      } else {
        set((state) => ({
          messages: [...state.messages, ...rawMessages],
          messagesTotal: totalCount,
          unreadMessageCount: unreadCount,
        }));
      }
      // Fetch delivery summaries for the loaded messages (non-blocking)
      const ids = rawMessages.map((m) => m.id);
      if (ids.length > 0) void get().fetchDeliverySummaries(ids);
    } catch (err) {
      reportError(err, "Failed to fetch messages", set);
    }
  },

  markMessageAsRead: async (id) => {
    // Guard: no-op if already read or already pending to prevent count drift
    const { messages, _pendingReadIds } = get();
    const msg = messages.find((m) => m.id === id);
    if (!msg || msg.is_read || _pendingReadIds.has(id)) return;

    const prevReadAt = msg.read_at;

    // Optimistically mark as read and add to pending set
    const readAt = new Date().toISOString();
    const markRead = (m: PersonaMessage) =>
      m.id === id ? { ...m, is_read: true, read_at: readAt } : m;

    set((state) => {
      const nextPending = new Set(state._pendingReadIds);
      nextPending.add(id);
      return {
        messages: state.messages.map(markRead),
        _pendingReadIds: nextPending,
        unreadMessageCount: Math.max(0, state.unreadMessageCount - 1),
      };
    });
    try {
      await markMessageRead(id);
      // Success: remove from pending set (count is already correct)
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return { _pendingReadIds: nextPending };
      });
    } catch (err) {
      logger.warn("markMessageAsRead failed, recovering state", { messageId: id, error: String(err) });
      // Rollback: remove from pending set and restore the message
      const rollback = (m: PersonaMessage) =>
        m.id === id ? { ...m, is_read: false, read_at: prevReadAt ?? null } : m;
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return {
          messages: state.messages.map(rollback),
          _pendingReadIds: nextPending,
          unreadMessageCount: state.unreadMessageCount + 1,
        };
      });
      reportError(err, "Failed to mark message as read", set);
    }
  },

  markAllMessagesAsRead: async (personaId?) => {
    try {
      await markAllMessagesRead(personaId);
      const readAt = new Date().toISOString();
      const shouldMark = (m: PersonaMessage) => !personaId || m.persona_id === personaId;
      set((state) => {
        const updatedMessages = state.messages.map((m) =>
          shouldMark(m) ? { ...m, is_read: true, read_at: readAt } : m,
        );
        const unreadMessageCount = updatedMessages.filter((m) => !m.is_read).length;
        return { messages: updatedMessages, unreadMessageCount };
      });
      // Fetch authoritative count in case the loaded list is a partial page
      await get().fetchUnreadMessageCount();
    } catch (err) {
      reportError(err, "Failed to mark all as read", set);
    }
  },

  deleteMessage: async (id) => {
    try {
      await deleteMessage(id);
      set((state) => {
        // Evict orphaned delivery summary for the deleted message
        const nextDeliverySummaries = new Map(state.deliverySummaries);
        nextDeliverySummaries.delete(id);

        return {
          messages: state.messages.filter((m) => m.id !== id),
          messagesTotal: Math.max(0, state.messagesTotal - 1),
          deliverySummaries: nextDeliverySummaries,
        };
      });
    } catch (err) {
      reportError(err, "Failed to delete message", set);
    }
  },

  fetchUnreadMessageCount: deduplicateFetch('unreadMessageCount', async () => {
    try {
      const unread = await getUnreadMessageCount();
      set({ unreadMessageCount: unread });
    } catch (err) {
      logger.warn("fetchUnreadMessageCount failed", { error: String(err) });
    }
  }),

  fetchDeliverySummaries: async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    try {
      const summaries = await getBulkDeliverySummaries(messageIds);
      set((state) => {
        const next = new Map(state.deliverySummaries);
        for (const s of summaries) next.set(s.messageId, s);
        // Bound the cache — scrolling through a large message history would
        // otherwise accumulate one summary per message viewed, indefinitely.
        // Map preserves insertion order, so drop the oldest past the cap.
        const CAP = 500;
        if (next.size > CAP) {
          for (const key of [...next.keys()].slice(0, next.size - CAP)) next.delete(key);
        }
        return { deliverySummaries: next };
      });
    } catch (err) { silentCatch("stores/slices/overview/messageSlice:catch1")(err); }
  },
});
