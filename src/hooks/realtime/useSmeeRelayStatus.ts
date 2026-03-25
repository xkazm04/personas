import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';

export interface SmeeRelayStatus {
  channel_url: string | null;
  connected: boolean;
  events_relayed: number;
  last_event_at: string | null;
  error: string | null;
}

const DEFAULT_STATUS: SmeeRelayStatus = {
  channel_url: null,
  connected: false,
  events_relayed: 0,
  last_event_at: null,
  error: null,
};

/**
 * Listens to the `smee-relay-status` Tauri event for real-time
 * Smee relay status updates.
 */
export function useSmeeRelayStatus(): SmeeRelayStatus {
  const [status, setStatus] = useState<SmeeRelayStatus>(DEFAULT_STATUS);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;

    listen<SmeeRelayStatus>(EventName.SMEE_RELAY_STATUS, (event) => {
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
