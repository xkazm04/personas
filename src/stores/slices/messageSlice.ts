import type { StateCreator } from "zustand";
import type { PersonaStore } from "../storeTypes";
import { errMsg } from "../storeTypes";
import type { PersonaMessage } from "@/lib/types/types";
import { enrichWithPersona } from "@/lib/types/types";
import * as api from "@/api/tauriApi";

export interface MessageSlice {
  // State
  messages: PersonaMessage[];
  messagesTotal: number;
  unreadMessageCount: number;
  /** IDs of messages with in-flight markAsRead calls (not yet confirmed by backend). */
  _pendingReadIds: Set<string>;

  // Actions
  fetchMessages: (reset?: boolean) => Promise<void>;
  markMessageAsRead: (id: string) => Promise<void>;
  markAllMessagesAsRead: (personaId?: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  fetchUnreadMessageCount: () => Promise<void>;
}

export const createMessageSlice: StateCreator<PersonaStore, [], [], MessageSlice> = (set, get) => ({
  messages: [],
  messagesTotal: 0,
  unreadMessageCount: 0,
  _pendingReadIds: new Set(),

  fetchMessages: async (reset = true) => {
    try {
      const PAGE_SIZE = 50;
      const offset = reset ? 0 : get().messages.length;
      const [rawMessages, totalCount, unreadCount] = await Promise.all([
        api.listMessages(PAGE_SIZE, offset),
        reset ? api.getMessageCount() : Promise.resolve(get().messagesTotal),
        api.getUnreadMessageCount(),
      ]);
      // Enrich with persona info
      const { personas } = get();
      const enriched: PersonaMessage[] = enrichWithPersona(rawMessages, personas);
      if (reset) {
        set({ messages: enriched, messagesTotal: totalCount, unreadMessageCount: unreadCount });
      } else {
        set((state) => ({
          messages: [...state.messages, ...enriched],
          messagesTotal: totalCount,
          unreadMessageCount: unreadCount,
        }));
      }
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch messages") });
    }
  },

  markMessageAsRead: async (id) => {
    // Guard: no-op if already read or already pending to prevent count drift
    const { messages, _pendingReadIds } = get();
    const msg = messages.find((m) => m.id === id);
    if (!msg || msg.is_read || _pendingReadIds.has(id)) return;

    const prevReadAt = msg.read_at;

    // Optimistically mark as read and add to pending set
    set((state) => {
      const nextPending = new Set(state._pendingReadIds);
      nextPending.add(id);
      return {
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m,
        ),
        _pendingReadIds: nextPending,
        unreadMessageCount: Math.max(0, state.unreadMessageCount - 1),
      };
    });
    try {
      await api.markMessageRead(id);
      // Success: remove from pending set (count is already correct)
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return { _pendingReadIds: nextPending };
      });
    } catch (err) {
      console.warn("[messageSlice] markMessageAsRead failed, recovering state:", err);
      // Rollback: remove from pending set and restore the message
      set((state) => {
        const nextPending = new Set(state._pendingReadIds);
        nextPending.delete(id);
        return {
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, is_read: false, read_at: prevReadAt ?? null } : m,
          ),
          _pendingReadIds: nextPending,
          unreadMessageCount: state.unreadMessageCount + 1,
        };
      });
      set({ error: errMsg(err, "Failed to mark message as read") });
    }
  },

  markAllMessagesAsRead: async (personaId?) => {
    try {
      await api.markAllMessagesRead(personaId);
      set((state) => {
        const updatedMessages = state.messages.map((m) => {
          if (!personaId || m.persona_id === personaId) {
            return { ...m, is_read: true, read_at: new Date().toISOString() };
          }
          return m;
        });
        // Recompute from the in-memory list; preserves unread from other personas
        // when a personaId filter is used. When marking all (no personaId), this is 0.
        const unreadMessageCount = updatedMessages.filter((m) => !m.is_read).length;
        return { messages: updatedMessages, unreadMessageCount };
      });
      // Fetch authoritative count in case the loaded list is a partial page
      await get().fetchUnreadMessageCount();
    } catch (err) {
      set({ error: errMsg(err, "Failed to mark all as read") });
    }
  },

  deleteMessage: async (id) => {
    try {
      await api.deleteMessage(id);
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== id),
        messagesTotal: Math.max(0, state.messagesTotal - 1),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete message") });
    }
  },

  fetchUnreadMessageCount: async () => {
    try {
      const unread = await api.getUnreadMessageCount();
      set({ unreadMessageCount: unread });
    } catch (err) {
      console.warn("[messageSlice] fetchUnreadMessageCount failed:", err);
    }
  },
});
