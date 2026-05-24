import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { EventFilterInput } from "@/lib/bindings/EventFilterInput";
import type { PaginatedEvents } from "@/lib/bindings/PaginatedEvents";
import type { PersonaEvent } from "@/lib/bindings/PersonaEvent";
import type { PersonaEventSubscription } from "@/lib/bindings/PersonaEventSubscription";
import type { CreateEventSubscriptionInput } from "@/lib/bindings/CreateEventSubscriptionInput";
import type { UpdateEventSubscriptionInput } from "@/lib/bindings/UpdateEventSubscriptionInput";
import type { DeadLetterConfig } from "@/lib/bindings/DeadLetterConfig";
import type { BulkDeadLetterOutcome } from "@/lib/bindings/BulkDeadLetterOutcome";

// ============================================================================
// Events
// ============================================================================

export const listEvents = (limit?: number, projectId?: string) =>
  invoke<PersonaEvent[]>("list_events", {
    limit: limit,
    projectId: projectId,
  });

export const listEventsInRange = (since: string, until: string, limit?: number) =>
  invoke<PaginatedEvents>("list_events_in_range", { since, until, limit });

export const searchEvents = (filter: EventFilterInput) =>
  invoke<PaginatedEvents>("search_events", { filter });

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

// ============================================================================
// Dead Letter Queue
// ============================================================================

export const listDeadLetterEvents = (limit?: number) =>
  invoke<PersonaEvent[]>("list_dead_letter_events", { limit });

export const countDeadLetterEvents = () =>
  invoke<number>("count_dead_letter_events");

export const retryDeadLetterEvent = (id: string) =>
  invoke<PersonaEvent>("retry_dead_letter_event", { id });

export const discardDeadLetterEvent = (id: string) =>
  invoke<boolean>("discard_dead_letter_event", { id });

/**
 * Read the dead-letter knobs the UI needs to mirror (currently just
 * `maxManualRetries`). Source of truth lives in
 * `src-tauri/src/db/repos/communication/events.rs::MAX_MANUAL_RETRIES`.
 * The DLQ tab fetches this on mount so the "Retry" / "exhausted" labels
 * always agree with the Rust cap, even after a backend bump.
 */
export const getDeadLetterConfig = () =>
  invoke<DeadLetterConfig>("get_dead_letter_config");

/**
 * Retry many dead-lettered events in a single backend transaction.
 * Returns per-id outcomes — `succeeded` ids are gone from the queue,
 * `failed` ids carry a short reason token (`retry_exhausted`,
 * `not_found`, `wrong_status`) the UI can surface verbatim.
 */
export const bulkRetryDeadLetterEvents = (ids: string[]) =>
  invoke<BulkDeadLetterOutcome>("bulk_retry_dead_letter_events", { ids });

/**
 * Discard many dead-lettered events in a single backend transaction.
 * Same per-id partial-failure shape as `bulkRetryDeadLetterEvents`.
 */
export const bulkDiscardDeadLetterEvents = (ids: string[]) =>
  invoke<BulkDeadLetterOutcome>("bulk_discard_dead_letter_events", { ids });
