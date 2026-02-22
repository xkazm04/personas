import { useEffect, useRef } from 'react';
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
 */
export function useEventBusListener(
  callback: (event: PersonaEvent) => void,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const subscriber: Subscriber = (event) => callbackRef.current(event);
    subscribers.add(subscriber);
    ensureListener();

    return () => {
      subscribers.delete(subscriber);
      teardownIfEmpty();
    };
  }, []);
}
