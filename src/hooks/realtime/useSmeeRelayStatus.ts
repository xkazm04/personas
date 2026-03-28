import { useState } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

export interface SmeeRelayStatus {
  connected: boolean;
  events_relayed: number;
  last_event_at: string | null;
  error: string | null;
}

const DEFAULT_STATUS: SmeeRelayStatus = {
  connected: false,
  events_relayed: 0,
  last_event_at: null,
  error: null,
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
