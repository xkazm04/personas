import type { StateCreator } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SystemStore } from '../../storeTypes';
import { reportError } from '../../storeTypes';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import { EventName } from '@/lib/eventRegistry';
import * as fleetApi from '@/api/fleet/fleet';

// Module-level guard so the three Tauri session listeners attach exactly once
// per app process, no matter how many surfaces (Fleet grid, Mastermind canvas,
// …) call fleetStartSessionListeners. Kept on globalThis so an HMR reload of
// this module doesn't double-register. The unlisten handles are retained only
// for completeness — the registry is process-lifetime, never torn down.
const FLEET_LISTENER_KEY = '__personasFleetSessionListeners';
type FleetListenerFlag = { started: boolean; unlisten: UnlistenFn[] };
const fleetListenerFlag = (): FleetListenerFlag => {
  const g = globalThis as unknown as Record<string, FleetListenerFlag | undefined>;
  return (g[FLEET_LISTENER_KEY] ??= { started: false, unlisten: [] });
};

/** One recorded lifecycle transition for the per-session sparkline. */
export interface FleetTransition {
  state: FleetSessionState;
  at: number;
}

/** Max transitions kept per session (in-memory; oldest dropped past this). */
const TRANSITION_CAP = 24;

/** Terminal color theme — `auto` tracks the app's light/dark appearance. */
export type FleetTerminalTheme = 'auto' | 'dark' | 'light';

/** Clamp bounds for the persisted terminal font zoom (mirror manager consts). */
const FONT_MIN = 9;
const FONT_MAX = 22;
const FONT_DEFAULT = 12;
const clampFont = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));

/**
 * State for the Fleet plugin (DEV-only Claude Code session aggregator).
 *
 * The Rust side owns the source-of-truth registry; this slice is a thin
 * client cache populated by event subscriptions (`FLEET_SESSION_STATE`,
 * `FLEET_REGISTRY_CHANGED`, `FLEET_SESSION_EXITED`) plus pull-based
 * `fleet_list_sessions()` snapshots.
 */
export interface FleetSlice {
  fleetSessions: FleetSession[];
  fleetHookPort: number;
  fleetHooksInstalled: boolean;
  fleetSessionsLoading: boolean;
  /** Currently-focused session in the grid — the one whose terminal pane renders. */
  fleetActiveSessionId: string | null;
  /** True while the fullscreen terminal-grid overlay is open. In-memory; the
   *  Athena orb reads it to float above the overlay so she's visible there. */
  fleetGridOpen: boolean;
  /** Count of detected interactive Claude processes Fleet doesn't track
   *  (orphans / external). Drives the Settings-tab badge so a restart's
   *  orphaned terminals are visible without opening Settings. In-memory,
   *  refreshed by a FleetPage poll + the process scanner. */
  fleetOrphanCount: number;
  /** Fire an OS notification when a session enters awaiting_input. Persisted. */
  fleetNotifyAwaiting: boolean;
  /** Auto-hibernate Idle/Stale sessions past the threshold (always-on Rust
   *  ticker). Persisted; pushed to Rust on change + on refresh. */
  fleetAutoHibernate: boolean;
  /** Inactivity minutes before auto-hibernate fires. Persisted; floored at 1. */
  fleetAutoHibernateMinutes: number;
  /** Live-slot scheduler: cap concurrent process-backed claude sessions;
   *  overflow Idle/Stale sessions are hibernated (resumable via Wake).
   *  Persisted; pushed to Rust on change + on refresh. */
  fleetLiveSlotsEnabled: boolean;
  /** Max concurrent live sessions when the scheduler is on. Persisted; clamped 1–64. */
  fleetMaxLiveSessions: number;
  /** Minutes of flat logs before a session flips Stale. Persisted; pushed to
   *  the Rust ticker on change + on refresh (clamped server-side too). */
  fleetStaleMinutes: number;
  /** Minutes of total PTY silence before a Running session is flagged frozen.
   *  Persisted; pushed like the stale cutoff. */
  fleetFrozenMinutes: number;
  /** Recent lifecycle transitions per session id — feeds the card sparkline. In-memory. */
  fleetTransitions: Record<string, FleetTransition[]>;
  /** Terminal font size in px (user zoom). Persisted, clamped 9–22. */
  fleetTerminalFontSize: number;
  /** Copy selected terminal text to the clipboard automatically. Persisted. */
  fleetTerminalCopyOnSelect: boolean;
  /** Terminal color theme; `auto` follows the app appearance. Persisted. */
  fleetTerminalTheme: FleetTerminalTheme;

  fleetRefresh: () => Promise<void>;
  /** Attach the three live Fleet session listeners (state / exited / registry)
   *  to this store — ONCE per process. Any surface that shows fleet sessions
   *  (Fleet grid, Mastermind canvas) calls this on mount so the store stays
   *  live-accurate without a poll. Idempotent; grid-local UI side effects
   *  (awaiting-input notifications, live-slot toasts) stay in the grid page. */
  fleetStartSessionListeners: () => void;
  fleetSetActiveSession: (id: string | null) => void;
  fleetSetGridOpen: (open: boolean) => void;
  fleetSetOrphanCount: (n: number) => void;
  fleetSetNotifyAwaiting: (on: boolean) => void;
  fleetSetAutoHibernate: (on: boolean) => void;
  fleetSetAutoHibernateMinutes: (minutes: number) => void;
  fleetSetLiveSlotsEnabled: (on: boolean) => void;
  fleetSetMaxLiveSessions: (max: number) => void;
  fleetSetStaleMinutes: (minutes: number) => void;
  fleetSetFrozenMinutes: (minutes: number) => void;
  /** Set the terminal font size (clamped); pass a delta via fleetNudgeFont. */
  fleetSetTerminalFontSize: (px: number) => void;
  fleetNudgeTerminalFont: (delta: number) => void;
  fleetSetTerminalCopyOnSelect: (on: boolean) => void;
  fleetSetTerminalTheme: (theme: FleetTerminalTheme) => void;
  /** Append a transition for a session (no-op if it repeats the last state). */
  fleetRecordTransition: (id: string, state: FleetSessionState) => void;
  /** Patch a single session by id in place (used by event handlers). */
  fleetPatchSession: (id: string, patch: Partial<FleetSession>) => void;
  fleetRemoveSessionLocal: (id: string) => void;
  fleetApplyHookStatus: (status: FleetHookStatus) => void;
}

export const createFleetSlice: StateCreator<SystemStore, [], [], FleetSlice> = (set, get) => ({
  fleetSessions: [],
  fleetHookPort: 0,
  fleetHooksInstalled: false,
  fleetSessionsLoading: false,
  fleetActiveSessionId: null,
  fleetGridOpen: false,
  fleetOrphanCount: 0,
  fleetNotifyAwaiting: true,
  fleetAutoHibernate: false,
  fleetAutoHibernateMinutes: 30,
  fleetLiveSlotsEnabled: false,
  fleetMaxLiveSessions: 10,
  fleetStaleMinutes: 6,
  fleetFrozenMinutes: 2,
  fleetTransitions: {},
  fleetTerminalFontSize: FONT_DEFAULT,
  fleetTerminalCopyOnSelect: true,
  fleetTerminalTheme: 'auto',

  fleetRefresh: async () => {
    // Sync the persisted auto-hibernate policy to the always-on Rust ticker.
    // (Opening Fleet at least once per app session activates an enabled policy;
    // a startup-side push is a tracked follow-up.)
    fleetApi.setAutoHibernate(get().fleetAutoHibernate, get().fleetAutoHibernateMinutes).catch(() => {});
    fleetApi.setStateCutoffs(get().fleetStaleMinutes * 60, get().fleetFrozenMinutes * 60).catch(() => {});
    fleetApi.setLiveSlots(get().fleetLiveSlotsEnabled ? get().fleetMaxLiveSessions : 0).catch(() => {});
    set({ fleetSessionsLoading: true });
    try {
      const snapshot = await fleetApi.listSessions();
      set({
        fleetSessions: snapshot.sessions,
        fleetHookPort: snapshot.hookPort,
        fleetHooksInstalled: snapshot.hooksInstalled,
        fleetSessionsLoading: false,
        error: null,
      });
    } catch (err) {
      reportError(err, 'Failed to load Fleet sessions', set, {
        stateUpdates: { fleetSessionsLoading: false },
      });
    }
  },

  fleetStartSessionListeners: () => {
    const flag = fleetListenerFlag();
    if (flag.started) return;
    flag.started = true;

    // FLEET_SESSION_STATE: patch the session row + record the transition. The
    // grid page keeps its OWN listener for the user-facing notification/toast
    // side effects — this one owns only the store mutation (no double-handling).
    void listen<{ session_id: string; state: string; reason?: string }>(
      EventName.FLEET_SESSION_STATE,
      (event) => {
        const { session_id, state, reason } = event.payload;
        get().fleetPatchSession(session_id, {
          state: state as FleetSessionState,
          stateReason: reason ?? null,
          lastActivityMs: BigInt(Date.now()),
        });
        get().fleetRecordTransition(session_id, state as FleetSessionState);
      },
    ).then((un) => flag.unlisten.push(un));

    void listen<{ session_id: string; exit_code: number | null }>(
      EventName.FLEET_SESSION_EXITED,
      (event) => {
        get().fleetPatchSession(event.payload.session_id, {
          state: 'exited' as FleetSessionState,
          exitCode: event.payload.exit_code,
          lastActivityMs: BigInt(Date.now()),
        });
        get().fleetRecordTransition(event.payload.session_id, 'exited' as FleetSessionState);
      },
    ).then((un) => flag.unlisten.push(un));

    void listen<{ kind: 'added' | 'removed' | 'updated'; session_id: string }>(
      EventName.FLEET_REGISTRY_CHANGED,
      (event) => {
        if (event.payload.kind === 'removed') get().fleetRemoveSessionLocal(event.payload.session_id);
        else void get().fleetRefresh(); // added/updated → re-fetch the full row
      },
    ).then((un) => flag.unlisten.push(un));
  },

  fleetSetActiveSession: (id) => set({ fleetActiveSessionId: id }),

  fleetSetGridOpen: (open) => set({ fleetGridOpen: open }),

  fleetSetOrphanCount: (n) => set({ fleetOrphanCount: Math.max(0, n) }),

  fleetSetNotifyAwaiting: (on) => set({ fleetNotifyAwaiting: on }),

  fleetSetAutoHibernate: (on) => {
    set({ fleetAutoHibernate: on });
    fleetApi.setAutoHibernate(on, get().fleetAutoHibernateMinutes).catch(() => {});
  },
  fleetSetAutoHibernateMinutes: (minutes) => {
    const m = Math.max(1, Math.round(minutes) || 1);
    set({ fleetAutoHibernateMinutes: m });
    fleetApi.setAutoHibernate(get().fleetAutoHibernate, m).catch(() => {});
  },

  fleetSetLiveSlotsEnabled: (on) => {
    set({ fleetLiveSlotsEnabled: on });
    fleetApi.setLiveSlots(on ? get().fleetMaxLiveSessions : 0).catch(() => {});
  },
  fleetSetMaxLiveSessions: (max) => {
    const m = Math.min(64, Math.max(1, Math.round(max) || 1));
    set({ fleetMaxLiveSessions: m });
    fleetApi.setLiveSlots(get().fleetLiveSlotsEnabled ? m : 0).catch(() => {});
  },

  fleetSetStaleMinutes: (minutes) => {
    const m = Math.min(60, Math.max(1, Math.round(minutes) || 1));
    set({ fleetStaleMinutes: m });
    fleetApi.setStateCutoffs(m * 60, get().fleetFrozenMinutes * 60).catch(() => {});
  },
  fleetSetFrozenMinutes: (minutes) => {
    const m = Math.min(60, Math.max(1, Math.round(minutes) || 1));
    set({ fleetFrozenMinutes: m });
    fleetApi.setStateCutoffs(get().fleetStaleMinutes * 60, m * 60).catch(() => {});
  },

  fleetSetTerminalFontSize: (px) => set({ fleetTerminalFontSize: clampFont(px) }),

  fleetNudgeTerminalFont: (delta) =>
    set((s) => ({ fleetTerminalFontSize: clampFont(s.fleetTerminalFontSize + delta) })),

  fleetSetTerminalCopyOnSelect: (on) => set({ fleetTerminalCopyOnSelect: on }),

  fleetSetTerminalTheme: (theme) => set({ fleetTerminalTheme: theme }),

  fleetRecordTransition: (id, state) =>
    set((s) => {
      const prev = s.fleetTransitions[id] ?? [];
      if (prev.length > 0 && prev[prev.length - 1]?.state === state) return s; // dedupe repeats
      const next = [...prev, { state, at: Date.now() }].slice(-TRANSITION_CAP);
      return { fleetTransitions: { ...s.fleetTransitions, [id]: next } };
    }),

  fleetPatchSession: (id, patch) =>
    set((state) => ({
      fleetSessions: state.fleetSessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),

  fleetRemoveSessionLocal: (id) =>
    set((state) => {
      const { [id]: _dropped, ...restTransitions } = state.fleetTransitions;
      return {
        fleetSessions: state.fleetSessions.filter((s) => s.id !== id),
        fleetActiveSessionId:
          state.fleetActiveSessionId === id ? null : state.fleetActiveSessionId,
        fleetTransitions: restTransitions,
      };
    }),

  fleetApplyHookStatus: (status) =>
    set({
      fleetHooksInstalled: status.installed && status.portMatches,
      fleetHookPort: status.installedPort ?? get().fleetHookPort,
    }),
});
