import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { ChatMessage } from "@/lib/bindings/ChatMessage";
import type { ChatRole } from "@/lib/bindings/ChatRole";
import type { ChatSession } from "@/lib/bindings/ChatSession";
import type { ChatSessionContext } from "@/lib/bindings/ChatSessionContext";

export const listChatSessions = (personaId: string, limit?: number) =>
  invoke<ChatSession[]>("list_chat_sessions", {
    personaId,
    limit: limit,
  });

export const getChatMessages = (
  personaId: string,
  sessionId: string,
  limit?: number,
) =>
  invoke<ChatMessage[]>("get_chat_messages", {
    personaId,
    sessionId,
    limit: limit,
  });

export const createChatMessage = (input: {
  personaId: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  executionId?: string;
  metadata?: string;
}) =>
  invoke<ChatMessage>("create_chat_message", {
    input: {
      personaId: input.personaId,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      executionId: input.executionId,
      metadata: input.metadata,
    },
  });

export const deleteChatSession = (personaId: string, sessionId: string) =>
  invoke<number>("delete_chat_session", { personaId, sessionId });

export const saveChatSessionContext = (input: {
  sessionId: string;
  personaId: string;
  title?: string | null;
  summary?: string | null;
  systemPromptHash?: string | null;
  workingMemory?: string | null;
  chatMode?: string | null;
  claudeSessionId?: string | null;
}) =>
  invoke<ChatSessionContext>("save_chat_session_context", {
    input: {
      sessionId: input.sessionId,
      personaId: input.personaId,
      title: input.title,
      summary: input.summary,
      systemPromptHash: input.systemPromptHash,
      workingMemory: input.workingMemory,
      chatMode: input.chatMode,
      claudeSessionId: input.claudeSessionId,
    },
  });

export const getChatSessionContext = (sessionId: string) =>
  invoke<ChatSessionContext | null>("get_chat_session_context", { sessionId });

export const getLatestChatSession = (personaId: string) =>
  invoke<ChatSessionContext | null>("get_latest_chat_session", { personaId });
