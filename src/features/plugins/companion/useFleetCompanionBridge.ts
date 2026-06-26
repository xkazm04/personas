import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { useCompanionStore } from './companionStore';

/** How long the notify-only "Athena auto-decided" orb pill stays up. */
const AUTO_NOTICE_MS = 7000;

/**
 * Tier-1 Companion ↔ Fleet bridge.
 *
 * Subscribes to Fleet's three lifecycle events and writes a structured
 * System episode to Athena's brain via `companion_record_fleet_event`.
 * The episode body carries machine-grep'able markers (`session:<id>`,
 * `state:<token>`, `cc:<claude_session_id>`) so Athena's hybrid retrieval
 * can find any fleet activity by id, state, or project.
 *
 * Mounted once at the PersonasPage root so it's active whenever the app
 * window is alive — independent of whether the chat panel is open or
 * which sidebar section the user is on. The cost per event is one
 * invoke (sub-ms locally) so we don't batch.
 *
 * Recursion guard: spawn events tagged `athena_owned: true` are flagged
 * in the episode so the proactive trigger evaluator can skip them when
 * deciding whether to surface a nudge (no point nudging Athena about
 * sessions Athena herself spawned). For now no JS-side spawn from
 * Athena exists yet (lands in Phase C), so this is always `false`.
 */
export function useFleetCompanionBridge(): void {
  // Pull session map via the existing slice. Cheap: useShallow would not
  // help here (we only read inside event callbacks via the ref).
  const sessions = useSystemStore((s) => s.fleetSessions);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const findSession = (id: string): FleetSession | undefined =>
      sessionsRef.current.find((s) => s.id === id);

    // The bridge is always-on and is the ONLY thing that keeps
    // `useSystemStore.fleetSessions` current when the Fleet page is not
    // mounted (the page's listeners are torn down on unmount). Without this
    // the store stays `[]` until the user opens the Fleet tab once, so every
    // handler below would hit its `if (!sess) return` guard and record
    // nothing. Coalesce snapshot refreshes: a burst of registry/state events —
    // or the Fleet page ALSO refreshing while it's mounted — would otherwise
    // fan out into many `fleet_list_sessions` IPC round trips. `fleetRefresh`
    // is idempotent (it replaces the whole snapshot), so collapsing a burst
    // into one fetch is safe, lossless, and non-destructive even when both
    // this bridge and the Fleet page refresh on the same event.
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        useSystemStore.getState().fleetRefresh().catch(silentCatch('useFleetCompanionBridge:refresh'));
      }, 150);
    };

    // Pull an initial snapshot on mount so `findSession` resolves for sessions
    // that already exist (incl. `claude` started externally before the app),
    // independent of whether the Fleet tab has ever been opened.
    useSystemStore.getState().fleetRefresh().catch(silentCatch('useFleetCompanionBridge:mount'));

    // Tracks the previous state per session so we can detect "added"
    // (no prior entry) vs "state_changed" (transition) without depending
    // on Fleet's coarse FLEET_REGISTRY_CHANGED { kind } field, which
    // sometimes coalesces multiple transitions into one "updated".
    const lastState = new Map<string, FleetSessionState>();

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        const sess = findSession(event.payload.session_id);
        if (!sess) {
          // Store hasn't caught up yet — actively pull a fresh snapshot so the
          // next event for this session resolves instead of silently dropping.
          scheduleRefresh();
          return;
        }
        lastState.set(event.payload.session_id, event.payload.state as FleetSessionState);
        invoke<string>('companion_record_fleet_event', {
          input: {
            sessionId: sess.id,
            claudeSessionId: sess.claudeSessionId,
            projectLabel: sess.projectLabel,
            cwd: sess.cwd,
            kind: 'state_changed',
            state: event.payload.state,
            reason: event.payload.reason ?? null,
          },
        }).catch(silentCatch('useFleetCompanionBridge:state'));
      },
    );

    const unExitedP = listen<{ session_id: string; exit_code: number | null }>(
      EventName.FLEET_SESSION_EXITED,
      (event) => {
        const sess = findSession(event.payload.session_id);
        if (!sess) {
          scheduleRefresh();
          return;
        }
        lastState.set(event.payload.session_id, 'exited');
        invoke<string>('companion_record_fleet_event', {
          input: {
            sessionId: sess.id,
            claudeSessionId: sess.claudeSessionId,
            projectLabel: sess.projectLabel,
            cwd: sess.cwd,
            kind: 'exited',
            exitCode: event.payload.exit_code,
          },
        }).catch(silentCatch('useFleetCompanionBridge:exited'));
      },
    );

    const unRegistryP = listen<{ kind: 'added' | 'removed' | 'updated'; session_id: string }>(
      EventName.FLEET_REGISTRY_CHANGED,
      (event) => {
        // Keep the store fresh independent of the Fleet page (mirrors
        // FleetGridPage, which re-fetches on add/update to get the full row).
        // Coalesced, so this is safe even when the Fleet page refreshes too.
        if (event.payload.kind !== 'removed') scheduleRefresh();
        if (event.payload.kind !== 'added') return;
        // "added" → wait one tick for the slice refresh, then record.
        setTimeout(() => {
          const sess = findSession(event.payload.session_id);
          if (!sess) return;
          if (lastState.has(sess.id)) return; // already recorded via state path
          lastState.set(sess.id, sess.state);
          invoke<string>('companion_record_fleet_event', {
            input: {
              sessionId: sess.id,
              claudeSessionId: sess.claudeSessionId,
              projectLabel: sess.projectLabel,
              cwd: sess.cwd,
              kind: 'spawned',
              athenaOwned: false,
            },
          }).catch(silentCatch('useFleetCompanionBridge:added'));
        }, 250);
      },
    );

    // Notify-only: Athena auto-fired a high-confidence fleet_send_input into
    // one of her own sessions. Flash a brief orb pill so the hands-off action
    // is visible without watching the grid. FYI only — no undo (user policy).
    let noticeTimer: number | undefined;
    const unAutoP = listen<{ sessionId: string; projectLabel: string; text: string }>(
      'athena://fleet/auto-decided',
      (event) => {
        useCompanionStore.getState().setFleetAutoNotice({
          sessionId: event.payload.sessionId,
          projectLabel: event.payload.projectLabel,
          text: event.payload.text,
          at: Date.now(),
        });
        if (noticeTimer) window.clearTimeout(noticeTimer);
        noticeTimer = window.setTimeout(() => {
          useCompanionStore.getState().clearFleetAutoNotice();
        }, AUTO_NOTICE_MS);
      },
    );

    return () => {
      unStateP.then((fn) => fn());
      unExitedP.then((fn) => fn());
      unRegistryP.then((fn) => fn());
      unAutoP.then((fn) => fn());
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (noticeTimer) window.clearTimeout(noticeTimer);
    };
  }, []);
}
