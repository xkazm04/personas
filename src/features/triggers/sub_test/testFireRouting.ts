/**
 * Which personas a test fire would actually reach.
 *
 * TestTab already loaded `listAllSubscriptions()` - it used them only to infer
 * which event types a persona EMITS, and then ignored listeners at fire time.
 * So the tab built to answer "did anyone run?" published an event, printed the
 * new event's id and status, and never named a single standing listener: it
 * proved the bus accepted a JSON blob and nothing more.
 */
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

export interface ListenerRow {
  subscriptionId: string;
  personaId: string;
  /** Subscriptions can be disabled; a disabled one would not have run. */
  enabled: boolean;
  /** The subscription's source filter, when it narrows further than the type. */
  sourceFilter: string | null;
}

/**
 * Standing listeners for one event type.
 *
 * `isCatalogEventType` is passed in rather than imported so this stays pure:
 * a catalog event type is a connector-provided template, not a persona-to-
 * persona route, and TestTab already excludes those when it reads the same
 * subscription list from the emitter side.
 */
export function listenersForEventType(
  subscriptions: readonly PersonaEventSubscription[],
  eventType: string | null,
  isCatalogEventType: (eventType: string) => boolean,
): ListenerRow[] {
  if (!eventType) return [];
  return subscriptions
    .filter((s) => s.event_type === eventType && !isCatalogEventType(s.event_type))
    .map((s) => ({
      subscriptionId: s.id,
      personaId: s.persona_id,
      enabled: s.enabled,
      sourceFilter: s.source_filter,
    }));
}

/**
 * What a fire's result lets us say about one listener - and no more.
 *
 * `testEventFlow` returns a PersonaEvent whose `target_persona_id` is OPTIONAL.
 * When it is set, the fire was addressed and every other listener was not
 * reached. When it is absent, the event was a broadcast and the result carries
 * no per-listener delivery record, so the honest answer is `unknown`, never a
 * fabricated "delivered".
 */
export type ListenerDelivery = 'targeted' | 'not-targeted' | 'unknown' | 'disabled';

export function deliveryForListener(
  row: ListenerRow,
  targetPersonaId: string | null | undefined,
): ListenerDelivery {
  if (!row.enabled) return 'disabled';
  if (!targetPersonaId) return 'unknown';
  return row.personaId === targetPersonaId ? 'targeted' : 'not-targeted';
}
