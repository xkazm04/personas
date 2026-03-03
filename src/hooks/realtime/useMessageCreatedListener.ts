import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';

type Subscriber = (message: PersonaMessage) => void;

const subscribers = new Set<Subscriber>();
let singletonUnlisten: UnlistenFn | null = null;
let setupPromise: Promise<void> | null = null;

function ensureListener() {
  if (setupPromise) return;
  setupPromise = (async () => {
    singletonUnlisten = await listen<PersonaMessage>('message-created', (event) => {
      const message = event.payload;
      for (const callback of subscribers) {
        callback(message);
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
