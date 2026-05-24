import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';
import { reportError } from '../../storeTypes';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import * as fleetApi from '@/api/fleet/fleet';

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

  fleetRefresh: () => Promise<void>;
  fleetSetActiveSession: (id: string | null) => void;
  fleetSetNotifyAwaiting: (on: boolean) => void;
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

  fleetPatchSession: (id, patch) =>
    set((state) => ({
      fleetSessions: state.fleetSessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),

  fleetRemoveSessionLocal: (id) =>
    set((state) => ({
      fleetSessions: state.fleetSessions.filter((s) => s.id !== id),
      fleetActiveSessionId:
        state.fleetActiveSessionId === id ? null : state.fleetActiveSessionId,
    })),

  fleetApplyHookStatus: (status) =>
    set({
      fleetHooksInstalled: status.installed && status.portMatches,
      fleetHookPort: status.installedPort ?? get().fleetHookPort,
    }),
});
