import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Creates a singleton Tauri listener hook for a given event name.
 *
 * Only one Tauri `listen(eventName)` subscription exists at any time,
 * regardless of how many React components use the returned hook.
 * Each hook invocation registers a callback; the singleton fans out
 * payloads to all active subscribers.
 *
 * Returns a hook: `(callback: (payload: T) => void) => boolean`
 * The boolean is `true` once the Tauri listener is confirmed attached.
 */
export function createSingletonListener<T>(eventName: string) {
  type Subscriber = (payload: T) => void;

  const subscribers = new Set<Subscriber>();
  let singletonUnlisten: UnlistenFn | null = null;
  let setupPromise: Promise<void> | null = null;
  let setupInFlight = false;

  /** Events that arrived while no subscribers were registered. */
  let earlyBuffer: T[] = [];
  const MAX_BUFFER = 50;

  function flushBuffer() {
    if (earlyBuffer.length === 0) return;
    const pending = earlyBuffer;
    earlyBuffer = [];
    for (const payload of pending) {
      for (const cb of subscribers) {
        cb(payload);
      }
    }
  }

  function ensureListener() {
    if (setupPromise) return;
    setupInFlight = true;
    setupPromise = (async () => {
      const unlisten = await listen<T>(eventName, (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (subscribers.size === 0) {
          // No subscribers yet — buffer for later delivery
          if (earlyBuffer.length < MAX_BUFFER) {
            earlyBuffer.push(payload);
          }
          return;
        }
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
    // Don't tear down while setup is still in-flight -- the setup completion
    // handler above will clean up when it resolves and finds zero subscribers.
    if (setupInFlight) return;
    if (singletonUnlisten) {
      singletonUnlisten();
      singletonUnlisten = null;
      setupPromise = null;
    }
  }

  return function useSingletonListener(
    callback: (payload: T) => void,
  ): boolean {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;
    const [attached, setAttached] = useState(false);

    useEffect(() => {
      let cancelled = false;
      const subscriber: Subscriber = (payload) => callbackRef.current(payload);
      subscribers.add(subscriber);
      ensureListener();

      // Flush any events that arrived before this subscriber registered
      flushBuffer();

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
  };
}
