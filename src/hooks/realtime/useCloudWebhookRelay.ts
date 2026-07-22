import { useState } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';
import type { CloudWebhookRelayStatus } from '@/lib/bindings/CloudWebhookRelayStatus';

export type { CloudWebhookRelayStatus } from '@/lib/bindings/CloudWebhookRelayStatus';

const DEFAULT_STATUS: CloudWebhookRelayStatus = {
  connected: false,
  lastPollAt: null,
  activeWebhookTriggers: 0,
  totalRelayed: 0n,
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
