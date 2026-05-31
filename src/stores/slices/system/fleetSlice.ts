import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';
import { reportError } from '../../storeTypes';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import * as fleetApi from '@/api/fleet/fleet';

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
  /** Recent lifecycle transitions per session id — feeds the card sparkline. In-memory. */
  fleetTransitions: Record<string, FleetTransition[]>;
  /** Terminal font size in px (user zoom). Persisted, clamped 9–22. */
  fleetTerminalFontSize: number;
  /** Copy selected terminal text to the clipboard automatically. Persisted. */
  fleetTerminalCopyOnSelect: boolean;
  /** Terminal color theme; `auto` follows the app appearance. Persisted. */
  fleetTerminalTheme: FleetTerminalTheme;

  fleetRefresh: () => Promise<void>;
  fleetSetActiveSession: (id: string | null) => void;
  fleetSetGridOpen: (open: boolean) => void;
  fleetSetOrphanCount: (n: number) => void;
  fleetSetNotifyAwaiting: (on: boolean) => void;
  fleetSetAutoHibernate: (on: boolean) => void;
  fleetSetAutoHibernateMinutes: (minutes: number) => void;
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
  fleetTransitions: {},
  fleetTerminalFontSize: FONT_DEFAULT,
  fleetTerminalCopyOnSelect: true,
  fleetTerminalTheme: 'auto',

  fleetRefresh: async () => {
    // Sync the persisted auto-hibernate policy to the always-on Rust ticker.
    // (Opening Fleet at least once per app session activates an enabled policy;
    // a startup-side push is a tracked follow-up.)
    fleetApi.setAutoHibernate(get().fleetAutoHibernate, get().fleetAutoHibernateMinutes).catch(() => {});
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
