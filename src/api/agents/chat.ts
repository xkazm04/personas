import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { ChatMessage } from "@/lib/bindings/ChatMessage";
import type { ChatSession } from "@/lib/bindings/ChatSession";

export const listChatSessions = (personaId: string, limit?: number) =>
  invoke<ChatSession[]>("list_chat_sessions", {
    personaId,
    limit: limit,
  });

export const createChatSession = (personaId: string, sessionId: string) =>
  invoke<ChatSession>("create_chat_session", {
    personaId,
    sessionId,
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
  role: "user" | "assistant";
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
