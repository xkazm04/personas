import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import { EventName } from '@/lib/eventRegistry';

type Subscriber = (message: PersonaMessage) => void;

const subscribers = new Set<Subscriber>();
let singletonUnlisten: UnlistenFn | null = null;
let setupPromise: Promise<void> | null = null;
let setupInFlight = false;

function ensureListener() {
  if (setupPromise) return;
  setupInFlight = true;
  setupPromise = (async () => {
    const unlisten = await listen<PersonaMessage>(EventName.MESSAGE_CREATED, (event) => {
      const message = event.payload;
      for (const callback of subscribers) {
        callback(message);
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
  // Don't tear down while setup is still in-flight -- the setup completion
  // handler will clean up when it resolves and finds zero subscribers.
  if (setupInFlight) return;
  if (singletonUnlisten) {
    singletonUnlisten();
    singletonUnlisten = null;
    setupPromise = null;
  }
}

export function useMessageCreatedListener(
  callback: (message: PersonaMessage) => void,
): boolean {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const subscriber: Subscriber = (message) => callbackRef.current(message);
    subscribers.add(subscriber);
    ensureListener();

    setupPromise?.then(() => {
      if (!cancelled) {
        setAttached(true);
      }
    });

    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
      teardownIfEmpty();
    };
  }, []);

  return attached;
}
