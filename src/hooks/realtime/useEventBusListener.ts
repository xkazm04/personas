import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

/**
 * Subscribes to the Tauri 'event-bus' channel and invokes a callback for each
 * incoming PersonaEvent. Uses a singleton listener internally -- multiple calls
 * share one Tauri subscription, eliminating duplicate events.
 *
 * Returns `true` once the Tauri listener is confirmed attached, `false` while
 * setup is pending or if the listener has been torn down.
 */
export const useEventBusListener = createSingletonListener<PersonaEvent>(
  EventName.EVENT_BUS,
);
