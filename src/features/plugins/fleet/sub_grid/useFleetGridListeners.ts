import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { EventName } from '@/lib/eventRegistry';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { notifyFleetAwaiting } from '@/lib/notifications/notifyFleetAwaiting';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The Sessions page's mount work: refresh the registry, load projects, start
 * the store-level session listeners, and keep the page's two UI-local side
 * effects on FLEET_SESSION_STATE (the live-slot eviction toast and the
 * awaiting-input desktop alert). Attached once for the life of the page; the
 * values the handler reads sit behind refs so a sessions update never tears
 * the listener down.
 */
export function useFleetGridListeners(sessions: FleetSession[]): void {
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const startSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const notifyAwaiting = useSystemStore((s) => s.fleetNotifyAwaiting);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();

  // `t`/`tx` are stable proxies, safe to close over.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const notifyRef = useRef(notifyAwaiting);
  notifyRef.current = notifyAwaiting;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  // Ids already alerted on, so a re-emitted awaiting_input event doesn't double-notify.
  const awaitingSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    refreshRef.current();
    fetchProjects().catch(silentCatch('FleetGridPage:fetchProjects'));

    // Store-level registration owns the session-row mutations for
    // FLEET_SESSION_STATE / _EXITED / _REGISTRY_CHANGED, attached once per
    // process. This page keeps only its UI-local side effects below.
    startSessionListeners();

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        const { session_id, state, reason } = event.payload;
        const nameOf = (fallback: string) => {
          const sess = sessionsRef.current.find((s) => s.id === session_id);
          return sess?.name ?? sess?.projectLabel ?? fallback;
        };

        // Live-slot cap eviction is safe (Idle/Stale only, resumable) but was
        // silent: the tile vanished from the live grid (2026-07-16 UAT
        // F-MAJOR-14). Announce it so the operator knows it was parked.
        if (state === 'hibernated' && reason?.includes('live-session limit')) {
          addToastRef.current(
            tx(t.plugins.fleet.live_slot_hibernated_toast, { name: nameOf(session_id.slice(0, 8)) }),
            'warning',
            8000,
          );
        }

        // Desktop "push" alert on entering awaiting_input, once per entry,
        // with the Notification message when the hook carried one.
        const seen = awaitingSeenRef.current;
        if (state !== 'awaiting_input') {
          seen.delete(session_id);
          return;
        }
        if (seen.has(session_id)) return;
        seen.add(session_id);
        if (!notifyRef.current) return;
        const name = nameOf('');
        const detail = reason?.trim();
        notifyFleetAwaiting(
          t.plugins.fleet.notify_title,
          detail
            ? tx(t.plugins.fleet.notify_body_detail, { name, detail })
            : tx(t.plugins.fleet.notify_body, { name }),
        );
      },
    );

    return () => {
      unStateP.then((fn) => fn());
    };
    // Attached once; everything it reads lives behind a ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
