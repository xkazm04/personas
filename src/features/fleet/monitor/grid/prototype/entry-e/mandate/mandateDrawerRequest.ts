// A request to open the mandate drawer from outside the Activity surface that
// owns it: the dock's act ticker (WP7) sits at Monitor level, the drawer's
// state lives in `useMandateDrawer`. The request waits here until a drawer
// host consumes it, so a press made while another Monitor tab is up opens the
// act log the next time Activity mounts rather than being lost.

import { create } from 'zustand';

export interface MandateDrawerRequest {
  /** Open the fleet-wide act log with this act selected. */
  actId: string;
  /** Bumps on every request, so pressing the same act twice opens it twice. */
  seq: number;
}

interface RequestState {
  pending: MandateDrawerRequest | null;
  /** A request to open the orphanage (the Orphans lane button, WP6); bumps per press. */
  orphans: number | null;
  request: (actId: string) => void;
  requestOrphans: () => void;
  consume: () => void;
  consumeOrphans: () => void;
}

export const useMandateDrawerRequest = create<RequestState>((set) => ({
  pending: null,
  orphans: null,
  request: (actId) => set((s) => ({ pending: { actId, seq: (s.pending?.seq ?? 0) + 1 } })),
  requestOrphans: () => set((s) => ({ orphans: (s.orphans ?? 0) + 1 })),
  consume: () => set({ pending: null }),
  consumeOrphans: () => set({ orphans: null }),
}));

/** Ask the mandate drawer to open the orphanage (the Orphans lane button). */
export function requestOrphanage(): void {
  useMandateDrawerRequest.getState().requestOrphans();
}

/** Ask the mandate drawer to open the act log at one act. */
export function requestActLogAt(actId: string): void {
  useMandateDrawerRequest.getState().request(actId);
}
