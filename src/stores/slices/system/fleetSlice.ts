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
  /** Fire an OS notification when a session enters awaiting_input. Persisted. */
  fleetNotifyAwaiting: boolean;
  /** Recent lifecycle transitions per session id — feeds the card sparkline. In-memory. */
  fleetTransitions: Record<string, FleetTransition[]>;

  fleetRefresh: () => Promise<void>;
  fleetSetActiveSession: (id: string | null) => void;
  fleetSetNotifyAwaiting: (on: boolean) => void;
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
  fleetNotifyAwaiting: true,
  fleetTransitions: {},

  fleetRefresh: async () => {
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

  fleetSetNotifyAwaiting: (on) => set({ fleetNotifyAwaiting: on }),

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
