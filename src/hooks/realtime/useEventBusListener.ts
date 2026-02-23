import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';

// ---------------------------------------------------------------------------
// Singleton Tauri listener
// ---------------------------------------------------------------------------
// Only one Tauri `listen('event-bus')` subscription exists at any time,
// regardless of how many React components call useEventBusListener.
// Each hook invocation registers a callback; the singleton fans out events
// to all active subscribers.

type Subscriber = (event: PersonaEvent) => void;

const subscribers = new Set<Subscriber>();
let singletonUnlisten: UnlistenFn | null = null;
let setupPromise: Promise<void> | null = null;

function ensureListener() {
  if (setupPromise) return;
  setupPromise = (async () => {
    singletonUnlisten = await listen<PersonaEvent>('event-bus', (tauriEvent) => {
      const payload = tauriEvent.payload;
      for (const cb of subscribers) {
        cb(payload);
      }
    });
  })();
}

function teardownIfEmpty() {
  if (subscribers.size === 0 && singletonUnlisten) {
    singletonUnlisten();
    singletonUnlisten = null;
    setupPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to the Tauri 'event-bus' channel and invokes a callback for each
 * incoming PersonaEvent. Uses a singleton listener internally — multiple calls
 * share one Tauri subscription, eliminating duplicate events.
 *
 * Returns `true` once the Tauri listener is confirmed attached, `false` while
 * setup is pending or if the listener has been torn down.
 */
export function useEventBusListener(
  callback: (event: PersonaEvent) => void,
): boolean {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const subscriber: Subscriber = (event) => callbackRef.current(event);
    subscribers.add(subscriber);
    ensureListener();

    // Mark attached once the singleton listener setup resolves
    setupPromise?.then(() => {
      if (!cancelled) setAttached(true);
    });

    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
      teardownIfEmpty();
    };
  }, []);

  return attached;
}
