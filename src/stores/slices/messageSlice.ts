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
    // Guard: no-op if already read to prevent count drift
    const msg = get().messages.find((m) => m.id === id);
    if (!msg || msg.is_read) return;

    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m,
      ),
      unreadMessageCount: Math.max(0, state.unreadMessageCount - 1),
    }));
    try {
      await api.markMessageRead(id);
    } catch {
      // Recover with authoritative count from server
      get().fetchMessages();
      get().fetchUnreadMessageCount();
    }
  },

  markAllMessagesAsRead: async (personaId?) => {
    try {
      await api.markAllMessagesRead(personaId);
      set((state) => ({
        messages: state.messages.map((m) => {
          if (!personaId || m.persona_id === personaId) {
            return { ...m, is_read: true, read_at: new Date().toISOString() };
          }
          return m;
        }),
        unreadMessageCount: 0,
      }));
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
    } catch {
      // Silent fail
    }
  },
});
