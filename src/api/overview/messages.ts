import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaMessage } from "@/lib/bindings/PersonaMessage";
import type { PersonaMessageDelivery } from "@/lib/bindings/PersonaMessageDelivery";

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

export const seedMockMessage = () =>
  invoke<PersonaMessage>("seed_mock_message", {});
