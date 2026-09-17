import { useState } from 'react';
import { EventName, type SmeeRelayStatusPayload } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

/**
 * The `smee-relay-status` payload, as the backend actually serializes it.
 *
 * `engine/smee_relay.rs` declares `#[serde(rename_all = "camelCase")]`, so the
 * wire keys are `eventsRelayed` / `lastEventAt`. This hook used to redeclare a
 * snake_case interface of its own, which type-checked against nothing and made
 * every live counter read `undefined`. One payload shape per event name: the
 * registry's `SmeeRelayStatusPayload` is that shape, and it is what
 * `EventPayloadMap[SMEE_RELAY_STATUS]` already promises.
 */
export type SmeeRelayStatus = SmeeRelayStatusPayload;

const DEFAULT_STATUS: SmeeRelayStatus = {
  connected: false,
  eventsRelayed: 0,
  lastEventAt: undefined,
  error: undefined,
};

const useSmeeRelayListener = createSingletonListener<SmeeRelayStatus>(
  EventName.SMEE_RELAY_STATUS,
);

/**
 * Listens to the `smee-relay-status` Tauri event for real-time
 * Smee relay status updates.
 */
export function useSmeeRelayStatus(): SmeeRelayStatus {
  const [status, setStatus] = useState<SmeeRelayStatus>(DEFAULT_STATUS);
  useSmeeRelayListener(setStatus);
  return status;
}
