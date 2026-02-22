import { invoke } from "@tauri-apps/api/core";

import type { PersonaEvent } from "@/lib/bindings/PersonaEvent";
import type { PersonaEventSubscription } from "@/lib/bindings/PersonaEventSubscription";
import type { CreateEventSubscriptionInput } from "@/lib/bindings/CreateEventSubscriptionInput";
import type { UpdateEventSubscriptionInput } from "@/lib/bindings/UpdateEventSubscriptionInput";

// ============================================================================
// Events
// ============================================================================

export const listEvents = (limit?: number, projectId?: string) =>
  invoke<PersonaEvent[]>("list_events", {
    limit: limit ?? null,
    projectId: projectId ?? null,
  });

export const listSubscriptions = (personaId: string) =>
  invoke<PersonaEventSubscription[]>("list_subscriptions", { personaId });

export const createSubscription = (input: CreateEventSubscriptionInput) =>
  invoke<PersonaEventSubscription>("create_subscription", { input });

export const updateSubscription = (
  id: string,
  input: UpdateEventSubscriptionInput,
) => invoke<PersonaEventSubscription>("update_subscription", { id, input });

export const deleteSubscription = (id: string) =>
  invoke<boolean>("delete_subscription", { id });

export const testEventFlow = (eventType: string, payload?: string) =>
  invoke<PersonaEvent>("test_event_flow", {
    eventType,
    payload: payload ?? null,
  });
