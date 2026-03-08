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
let setupInFlight = false;

function ensureListener() {
  if (setupPromise) return;
  setupInFlight = true;
  setupPromise = (async () => {
    const unlisten = await listen<PersonaEvent>('event-bus', (tauriEvent) => {
      const payload = tauriEvent.payload;
      for (const cb of subscribers) {
        cb(payload);
      }
    });
    setupInFlight = false;

    // If all subscribers left while setup was in-flight, tear down immediately
    if (subscribers.size === 0) {
      unlisten();
      singletonUnlisten = null;
      setupPromise = null;
    } else {
      singletonUnlisten = unlisten;
    }
  })();
}

function teardownIfEmpty() {
  if (subscribers.size > 0) return;
  // Don't tear down while setup is still in-flight — the setup completion
  // handler above will clean up when it resolves and finds zero subscribers.
  if (setupInFlight) return;
  if (singletonUnlisten) {
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
