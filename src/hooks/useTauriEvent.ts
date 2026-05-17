import { useEffect } from 'react';
import { listen, type Event, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { silentCatch } from '@/lib/silentCatch';
import { typedListen, type EventPayloadMap } from '@/lib/eventRegistry';

/**
 * Subscribe to a Tauri event for the lifetime of the component.
 *
 * Collapses the boilerplate that otherwise sits inline in every consumer:
 *
 *   useEffect(() => {
 *     let unlisten: UnlistenFn | undefined;
 *     let cancelled = false;
 *     listen<T>(EVENT, (e) => { if (cancelled) return; handler(e); })
 *       .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
 *       .catch(silentCatch('event_listen'));
 *     return () => { cancelled = true; unlisten?.(); };
 *   }, [...deps]);
 *
 * The cancelled flag is needed because `listen()` is async; if the
 * component unmounts (or the effect re-runs) before the subscription
 * resolves, we have to tear down whatever did register.
 *
 * @param eventName  The Tauri event name to subscribe to.
 * @param handler    Called with each event payload. Wrap in useCallback at
 *                   the call site to keep the dependency array stable.
 * @param errorContext Sentry-breadcrumb tag used by silentCatch when
 *                   the underlying listen() rejects.
 *
 * The hook intentionally does NOT take an explicit deps array — `handler`
 * is the only dependency, and the call site controls its identity. This
 * mirrors `useEffect`'s discipline: stable handlers via `useCallback`.
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: EventCallback<T>,
  errorContext: string = `tauri_event:${eventName}`,
): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<T>(eventName, (event) => {
      if (cancelled) return;
      handler(event);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(silentCatch(errorContext));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName, handler, errorContext]);
}

/**
 * Type-safe sibling of {@link useTauriEvent}. Subscribes to an event whose
 * payload shape is registered in `EventPayloadMap` (see `@/lib/eventRegistry`)
 * and types the handler's first argument accordingly.
 *
 * Use this whenever the call site would otherwise reach for
 * `typedListen(EventName.X, ...)` inside a `useEffect` — it avoids the
 * asynchronous-cleanup race that bit `ContextMapPage` and friends.
 *
 * @param eventName  A key of `EventPayloadMap` (typically `EventName.X`).
 * @param handler    Called with `(payload, rawEvent)`. Wrap in `useCallback`
 *                   at the call site to keep the dependency array stable.
 * @param errorContext Sentry-breadcrumb tag used by silentCatch when the
 *                   underlying typedListen() rejects.
 */
export function useTypedTauriEvent<K extends keyof EventPayloadMap>(
  eventName: K,
  handler: (payload: EventPayloadMap[K], raw: Event<EventPayloadMap[K]>) => void,
  errorContext: string = `tauri_event:${String(eventName)}`,
): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    typedListen(eventName, (payload, raw) => {
      if (cancelled) return;
      handler(payload, raw);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(silentCatch(errorContext));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName, handler, errorContext]);
}
