import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { ChatMessage } from "@/lib/bindings/ChatMessage";
import type { ChatSession } from "@/lib/bindings/ChatSession";
import {
  listChatSessions,
  getChatMessages,
  createChatMessage,
  createChatSession,
  deleteChatSession,
} from "@/api/agents/chat";
import { executePersona } from "@/api/agents/executions";

export interface ChatSlice {
  // State
  chatSessions: ChatSession[];
  chatMessages: ChatMessage[];
  activeChatSessionId: string | null;
  chatStreaming: boolean;

  // Actions
  fetchChatSessions: (personaId: string) => Promise<void>;
  fetchChatMessages: (personaId: string, sessionId: string) => Promise<void>;
  startNewChatSession: (personaId: string) => Promise<string>;
  sendChatMessage: (personaId: string, sessionId: string, content: string) => Promise<void>;
  clearChatSession: (personaId: string, sessionId: string) => Promise<void>;
  appendChatStreamLine: (line: string) => void;
  finishChatStream: (fullResponse: string, personaId: string, sessionId: string, executionId?: string) => Promise<void>;
}

/** Maximum in-memory chat messages per session. Older messages are evicted FIFO. */
const MAX_CHAT_MESSAGES = 500;

export const createChatSlice: StateCreator<AgentStore, [], [], ChatSlice> = (set, get) => ({
  chatSessions: [],
  chatMessages: [],
  activeChatSessionId: null,
  chatStreaming: false,

  fetchChatSessions: async (personaId) => {
    try {
      const sessions = await listChatSessions(personaId);
      const activeId = get().activeChatSessionId;
      // Clear the active session if it no longer exists in the persisted list
      const activeGone =
        activeId && sessions.length > 0 && !sessions.some((s) => s.sessionId === activeId);
      set({
        chatSessions: sessions,
        ...(activeGone ? { activeChatSessionId: null, chatMessages: [] } : {}),
      });
    } catch (err) {
      reportError(err, "Failed to fetch chat sessions", set);
    }
  },

  fetchChatMessages: async (personaId, sessionId) => {
    try {
      const messages = await getChatMessages(personaId, sessionId);
      // Cap in-memory messages to prevent unbounded growth in long sessions
      set({ chatMessages: messages.slice(-MAX_CHAT_MESSAGES), activeChatSessionId: sessionId });
    } catch (err) {
      reportError(err, "Failed to fetch chat messages", set);
    }
  },

  startNewChatSession: async (personaId) => {
    const sessionId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({ activeChatSessionId: sessionId, chatMessages: [] });
    try {
      await createChatSession(personaId, sessionId);
    } catch (err) {
      // Session failed to persist — roll back the optimistic state
      set((s) =>
        s.activeChatSessionId === sessionId
          ? { activeChatSessionId: null, chatMessages: [] }
          : {},
      );
      reportError(err, "Failed to create chat session", set);
      return "";
    }
    return sessionId;
  },

  sendChatMessage: async (personaId, sessionId, content) => {
    // 1. Persist user message
    const userMsg = await createChatMessage({
      personaId,
      sessionId,
      role: "user",
      content,
    });
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg].slice(-MAX_CHAT_MESSAGES) }));

    // 2. Build conversation context for the execution
    const allMessages = get().chatMessages;
    const contextLines = allMessages.map(
      (m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`,
    );
    contextLines.push(`Human: ${content}`);
    const conversationInput = JSON.stringify({
      _chat: true,
      conversation: contextLines.join("\n\n"),
      latest_message: content,
    });

    // 3. Start execution with conversation context
    set({ chatStreaming: true });
    try {
      await executePersona(personaId, undefined, conversationInput);
    } catch (err) {
      reportError(err, "Failed to send chat message", set, { stateUpdates: { chatStreaming: false } });
    }
  },

  clearChatSession: async (personaId, sessionId) => {
    try {
      await deleteChatSession(personaId, sessionId);
      set((s) => ({
        chatSessions: s.chatSessions.filter((cs) => cs.sessionId !== sessionId),
        chatMessages: s.activeChatSessionId === sessionId ? [] : s.chatMessages,
        activeChatSessionId: s.activeChatSessionId === sessionId ? null : s.activeChatSessionId,
      }));
    } catch (err) {
      reportError(err, "Failed to clear chat session", set);
    }
  },

  appendChatStreamLine: (_line) => {
    // Streaming lines are accumulated and displayed in real-time via executionOutput
    // This is a no-op; the ChatTab reads executionOutput directly from the store
  },

  finishChatStream: async (fullResponse, personaId, sessionId, executionId) => {
    if (!fullResponse.trim()) {
      set({ chatStreaming: false });
      return;
    }
    try {
      const assistantMsg = await createChatMessage({
        personaId,
        sessionId,
        role: "assistant",
        content: fullResponse,
        executionId,
      });
      set((s) => ({
        chatMessages: [...s.chatMessages, assistantMsg].slice(-MAX_CHAT_MESSAGES),
        chatStreaming: false,
      }));
    } catch {
      set({ chatStreaming: false });
    }
  },
});
