import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

/**
 * Subscribes to the Tauri 'message-created' channel and invokes a callback
 * for each incoming PersonaMessage. Uses a singleton listener internally.
 *
 * Returns `true` once the Tauri listener is confirmed attached.
 */
export const useMessageCreatedListener = createSingletonListener<PersonaMessage>(
  EventName.MESSAGE_CREATED,
);
