import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("messages");
import type { PersonaMessage } from "@/lib/types/types";
import { deleteMessage, getMessageCount, getUnreadMessageCount, listMessages, markAllMessagesRead, markMessageRead, getBulkDeliverySummaries, getThreadSummaries, getThreadCount, getMessagesByThread } from "@/api/overview/messages";
import type { MessageDeliverySummary } from "@/lib/bindings/MessageDeliverySummary";
import type { MessageThreadSummary } from "@/lib/bindings/MessageThreadSummary";
import { deduplicateFetch } from "@/lib/utils/deduplicateFetch";


export interface MessageSlice {
  // State
  messages: PersonaMessage[];
  messagesTotal: number;
  unreadMessageCount: number;
  /** IDs of messages with in-flight markAsRead calls (not yet confirmed by backend). */
  _pendingReadIds: Set<string>;
  /** Delivery status summaries keyed by message ID. */
  deliverySummaries: Map<string, MessageDeliverySummary>;

  // Thread state
  threadSummaries: MessageThreadSummary[];
  threadCount: number;
  expandedThreadId: string | null;
  threadReplies: Map<string, PersonaMessage[]>;
  viewMode: 'flat' | 'threaded';

  // Actions
  fetchMessages: (reset?: boolean) => Promise<void>;
  markMessageAsRead: (id: string) => Promise<void>;
  markAllMessagesAsRead: (personaId?: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  fetchUnreadMessageCount: () => Promise<void>;
  fetchDeliverySummaries: (messageIds: string[]) => Promise<void>;
  setViewMode: (mode: 'flat' | 'threaded') => void;
  fetchThreadSummaries: (reset?: boolean, personaId?: string) => Promise<void>;
  expandThread: (threadId: string) => Promise<void>;
  collapseThread: () => void;
}

export const createMessageSlice: StateCreator<OverviewStore, [], [], MessageSlice> = (set, get) => ({
  messages: [],
  messagesTotal: 0,
  unreadMessageCount: 0,
  _pendingReadIds: new Set(),
  deliverySummaries: new Map(),
  threadSummaries: [],
  threadCount: 0,
  expandedThreadId: null,
  threadReplies: new Map(),
  viewMode: 'flat',

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
        set({ messages: rawMessages, messagesTotal: totalCount, unreadMessageCount: unreadCount });
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
      // Propagate read status into threadReplies cache
      const nextThreadReplies = new Map(state.threadReplies);
      for (const [threadId, replies] of nextThreadReplies) {
        if (replies.some((r) => r.id === id)) {
          nextThreadReplies.set(threadId, replies.map(markRead));
        }
      }
      return {
        messages: state.messages.map(markRead),
        threadReplies: nextThreadReplies,
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
        // Rollback threadReplies cache too
        const nextThreadReplies = new Map(state.threadReplies);
        for (const [threadId, replies] of nextThreadReplies) {
          if (replies.some((r) => r.id === id)) {
            nextThreadReplies.set(threadId, replies.map(rollback));
          }
        }
        return {
          messages: state.messages.map(rollback),
          threadReplies: nextThreadReplies,
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
        // Propagate read status into threadReplies cache
        const nextThreadReplies = new Map(state.threadReplies);
        for (const [threadId, replies] of nextThreadReplies) {
          if (replies.some((r) => shouldMark(r) && !r.is_read)) {
            nextThreadReplies.set(
              threadId,
              replies.map((r) => (shouldMark(r) ? { ...r, is_read: true, read_at: readAt } : r)),
            );
          }
        }
        const unreadMessageCount = updatedMessages.filter((m) => !m.is_read).length;
        return { messages: updatedMessages, threadReplies: nextThreadReplies, unreadMessageCount };
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
        // Remove from threadReplies cache so ghost messages don't appear
        const nextThreadReplies = new Map(state.threadReplies);
        for (const [threadId, replies] of nextThreadReplies) {
          const filtered = replies.filter((m) => m.id !== id);
          if (filtered.length !== replies.length) {
            if (filtered.length === 0) {
              nextThreadReplies.delete(threadId);
            } else {
              nextThreadReplies.set(threadId, filtered);
            }
          }
        }
        // Update thread summaries: decrement reply_count, remove if thread root was deleted
        const nextThreadSummaries = state.threadSummaries
          .filter((ts) => ts.threadId !== id)
          .map((ts) => {
            const cachedReplies = nextThreadReplies.get(ts.threadId);
            if (cachedReplies) {
              return { ...ts, replyCount: cachedReplies.length };
            }
            return ts;
          });
        // Evict orphaned delivery summary for the deleted message
        const nextDeliverySummaries = new Map(state.deliverySummaries);
        nextDeliverySummaries.delete(id);

        return {
          messages: state.messages.filter((m) => m.id !== id),
          messagesTotal: Math.max(0, state.messagesTotal - 1),
          deliverySummaries: nextDeliverySummaries,
          threadReplies: nextThreadReplies,
          threadSummaries: nextThreadSummaries,
          threadCount: nextThreadSummaries.length !== state.threadSummaries.length
            ? Math.max(0, state.threadCount - 1)
            : state.threadCount,
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
        return { deliverySummaries: next };
      });
    } catch {
      // Non-critical: delivery badges just won't show
    }
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
    if (mode === 'threaded') {
      void get().fetchThreadSummaries(true);
    }
  },

  fetchThreadSummaries: async (reset = true, personaId?) => {
    try {
      const PAGE_SIZE = 50;
      const offset = reset ? 0 : get().threadSummaries.length;
      const [summaries, count] = await Promise.all([
        getThreadSummaries(PAGE_SIZE, offset, personaId),
        reset ? getThreadCount(personaId) : Promise.resolve(get().threadCount),
      ]);
      if (reset) {
        set({ threadSummaries: summaries, threadCount: count });
      } else {
        set((state) => ({
          threadSummaries: [...state.threadSummaries, ...summaries],
          threadCount: count,
        }));
      }
    } catch (err) {
      reportError(err, "Failed to fetch thread summaries", set);
    }
  },

  expandThread: async (threadId: string) => {
    set({ expandedThreadId: threadId });
    // Only fetch if not already cached
    if (get().threadReplies.has(threadId)) return;
    try {
      const rawReplies = await getMessagesByThread(threadId);
      set((state) => {
        const next = new Map(state.threadReplies);
        next.set(threadId, rawReplies);
        return { threadReplies: next };
      });
    } catch (err) {
      logger.warn("expandThread failed", { threadId, error: String(err) });
    }
  },

  collapseThread: () => {
    set({ expandedThreadId: null });
  },
});
