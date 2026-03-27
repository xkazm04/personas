import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaMessage } from "@/lib/bindings/PersonaMessage";
import type { PersonaMessageDelivery } from "@/lib/bindings/PersonaMessageDelivery";
import type { MessageDeliverySummary } from "@/lib/bindings/MessageDeliverySummary";
import type { MessageThreadSummary } from "@/lib/bindings/MessageThreadSummary";

// ============================================================================
// Messages
// ============================================================================

export const listMessages = (limit?: number, offset?: number) =>
  invoke<PersonaMessage[]>("list_messages", {
    limit: limit,
    offset: offset,
  });

export const getMessage = (id: string) =>
  invoke<PersonaMessage>("get_message", { id });

export const markMessageRead = (id: string) =>
  invoke<void>("mark_message_read", { id });

export const markAllMessagesRead = (personaId?: string) =>
  invoke<void>("mark_all_messages_read", {
    personaId: personaId,
  });

export const deleteMessage = (id: string) =>
  invoke<boolean>("delete_message", { id });

export const getUnreadMessageCount = () =>
  invoke<number>("get_unread_message_count", {});

export const getMessageCount = () =>
  invoke<number>("get_message_count", {});

export const getMessageDeliveries = (messageId: string) =>
  invoke<PersonaMessageDelivery[]>("get_message_deliveries", { messageId });

export const getBulkDeliverySummaries = (messageIds: string[]) =>
  invoke<MessageDeliverySummary[]>("get_bulk_delivery_summaries", { messageIds });

// ============================================================================
// Threads
// ============================================================================

export const getMessagesByThread = (threadId: string) =>
  invoke<PersonaMessage[]>("get_messages_by_thread", { threadId });

export const getThreadSummaries = (limit?: number, offset?: number, personaId?: string) =>
  invoke<MessageThreadSummary[]>("get_thread_summaries", { limit, offset, personaId });

export const getThreadCount = (personaId?: string) =>
  invoke<number>("get_thread_count", { personaId });

// ============================================================================
// Dev
// ============================================================================

export const seedMockMessage = () =>
  invoke<PersonaMessage>("seed_mock_message", {});
