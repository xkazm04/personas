import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { useSystemStore } from '@/stores/systemStore';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

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

    // Tracks the previous state per session so we can detect "added"
    // (no prior entry) vs "state_changed" (transition) without depending
    // on Fleet's coarse FLEET_REGISTRY_CHANGED { kind } field, which
    // sometimes coalesces multiple transitions into one "updated".
    const lastState = new Map<string, FleetSessionState>();

    const unStateP = listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        const sess = findSession(event.payload.session_id);
        if (!sess) return; // store hasn't caught up yet; the FLEET_REGISTRY_CHANGED path will record it
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
        if (!sess) return;
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

    return () => {
      unStateP.then((fn) => fn());
      unExitedP.then((fn) => fn());
      unRegistryP.then((fn) => fn());
    };
  }, []);
}
