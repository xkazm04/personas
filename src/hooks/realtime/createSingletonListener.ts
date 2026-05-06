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
 * Returns a hook: `(callback, onDrop?) => boolean`
 * - `callback`: invoked for each payload.
 * - `onDrop`: optional, invoked with the running total of events dropped
 *   from the early-arrival buffer (subscribers absent, buffer full).
 * The boolean is `true` once the Tauri listener is confirmed attached.
 */
export function createSingletonListener<T>(eventName: string) {
  type Subscriber = (payload: T) => void;
  type DropListener = (totalDropped: number) => void;

  const subscribers = new Set<Subscriber>();
  const dropListeners = new Set<DropListener>();
  let singletonUnlisten: UnlistenFn | null = null;
  let setupPromise: Promise<void> | null = null;
  let setupInFlight = false;

  /** Events that arrived while no subscribers were registered. */
  let earlyBuffer: T[] = [];
  let earlyDroppedCount = 0;
  let dropWarningEmitted = false;
  const MAX_BUFFER = 50;

  function recordEarlyDrop() {
    earlyDroppedCount += 1;
    if (!dropWarningEmitted) {
      dropWarningEmitted = true;
      console.warn(
        `[realtime] singleton listener "${eventName}" exceeded early-buffer cap of ${MAX_BUFFER}; further drops this session will be counted silently`,
      );
    }
    for (const listener of dropListeners) {
      listener(earlyDroppedCount);
    }
  }

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

  function ensureListener(): Promise<void> {
    if (setupPromise) return setupPromise;
    setupInFlight = true;
    setupPromise = (async () => {
      const unlisten = await listen<T>(eventName, (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (subscribers.size === 0) {
          // No subscribers yet — buffer for later delivery
          if (earlyBuffer.length < MAX_BUFFER) {
            earlyBuffer.push(payload);
          } else {
            recordEarlyDrop();
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
    return setupPromise;
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

  function useSingletonListener(
    callback: (payload: T) => void,
    onDrop?: DropListener,
  ): boolean {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;
    const onDropRef = useRef(onDrop);
    onDropRef.current = onDrop;
    const [attached, setAttached] = useState(false);

    useEffect(() => {
      let cancelled = false;
      const subscriber: Subscriber = (payload) => callbackRef.current(payload);
      subscribers.add(subscriber);

      const dropListener: DropListener = (total) => onDropRef.current?.(total);
      dropListeners.add(dropListener);
      // Surface any drops that already happened before this subscriber mounted.
      if (earlyDroppedCount > 0) {
        onDropRef.current?.(earlyDroppedCount);
      }

      const currentSetup = ensureListener();

      // Flush any events that arrived before this subscriber registered
      flushBuffer();

      currentSetup.then(() => {
        if (!cancelled) setAttached(true);
      });

      return () => {
        cancelled = true;
        subscribers.delete(subscriber);
        dropListeners.delete(dropListener);
        teardownIfEmpty();
      };
    }, []);

    return attached;
  }

  useSingletonListener.getEarlyDroppedCount = () => earlyDroppedCount;

  return useSingletonListener;
}
