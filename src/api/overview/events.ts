import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaEvent } from "@/lib/bindings/PersonaEvent";
import type { PersonaEventSubscription } from "@/lib/bindings/PersonaEventSubscription";
import type { CreateEventSubscriptionInput } from "@/lib/bindings/CreateEventSubscriptionInput";
import type { UpdateEventSubscriptionInput } from "@/lib/bindings/UpdateEventSubscriptionInput";

// ============================================================================
// Events
// ============================================================================

export const listEvents = (limit?: number, projectId?: string) =>
  invoke<PersonaEvent[]>("list_events", {
    limit: limit,
    projectId: projectId,
  });

export const listEventsInRange = (since: string, until: string) =>
  invoke<PersonaEvent[]>("list_events_in_range", { since, until });

export const listSubscriptions = (personaId: string) =>
  invoke<PersonaEventSubscription[]>("list_subscriptions", { personaId });

export const listAllSubscriptions = () =>
  invoke<PersonaEventSubscription[]>("list_all_subscriptions");

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
    payload: payload,
  });

export const seedMockEvent = () =>
  invoke<PersonaEvent>("seed_mock_event", {});
