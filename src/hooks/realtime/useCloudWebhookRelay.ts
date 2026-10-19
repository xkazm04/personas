import { useCallback, useEffect, useRef, useState } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { cloudWebhookRelayStatus } from '@/api/system/cloud';
import { silentCatch } from '@/lib/silentCatch';
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
 * Snapshot plus stream for the cloud webhook relay.
 *
 * The backend emits `cloud-webhook-relay-status` only from a relay tick
 * (15 s while active, 60 s idle, first one 10 s after boot). Listening alone
 * left a freshly mounted view on `DEFAULT_STATUS` (`connected: false`) until
 * the next tick, and `CloudWebhooksTab` renders its "not connected" empty
 * state from exactly that flag, so a connected user was told they were not
 * connected for up to a minute every time the tab opened.
 *
 * The mount reads `cloud_webhook_relay_status` once. A pushed status that
 * lands before the read resolves is newer than the read, so the read is
 * dropped in that case rather than painted over it.
 */
export function useCloudWebhookRelay(): CloudWebhookRelayStatus {
  const [status, setStatus] = useState<CloudWebhookRelayStatus>(DEFAULT_STATUS);
  const streamedRef = useRef(false);

  const onPush = useCallback((next: CloudWebhookRelayStatus) => {
    streamedRef.current = true;
    setStatus(next);
  }, []);
  useCloudWebhookRelayListener(onPush);

  useEffect(() => {
    let cancelled = false;
    cloudWebhookRelayStatus()
      .then((snapshot) => {
        if (!cancelled && !streamedRef.current) setStatus(snapshot);
      })
      .catch(silentCatch('hooks/realtime/useCloudWebhookRelay:snapshot'));
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
