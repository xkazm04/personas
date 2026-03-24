import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';

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

/**
 * Listens to the `cloud-webhook-relay-status` Tauri event for real-time
 * relay status updates. Returns the current relay state.
 */
export function useCloudWebhookRelay(): CloudWebhookRelayStatus {
  const [status, setStatus] = useState<CloudWebhookRelayStatus>(DEFAULT_STATUS);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;

    listen<CloudWebhookRelayStatus>(EventName.CLOUD_WEBHOOK_RELAY_STATUS, (event) => {
      if (!cancelled) {
        setStatus(event.payload);
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  return status;
}
