import { useEffect } from 'react';
import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { silentCatch } from '@/lib/silentCatch';

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
