import { useState } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

export interface CloudWebhookRelayStatus {
  connected: boolean;
  last_poll_at: string | null;
  active_webhook_triggers: number;
  total_relayed: number;
  error: string | null;
}

const DEFAULT_STATUS: CloudWebhookRelayStatus = {
  connected: false,
  last_poll_at: null,
  active_webhook_triggers: 0,
  total_relayed: 0,
  error: null,
};

const useCloudWebhookRelayListener = createSingletonListener<CloudWebhookRelayStatus>(
  EventName.CLOUD_WEBHOOK_RELAY_STATUS,
);

/**
 * Listens to the `cloud-webhook-relay-status` Tauri event for real-time
 * relay status updates. Returns the current relay state.
 */
export function useCloudWebhookRelay(): CloudWebhookRelayStatus {
  const [status, setStatus] = useState<CloudWebhookRelayStatus>(DEFAULT_STATUS);
  useCloudWebhookRelayListener(setStatus);
  return status;
}
