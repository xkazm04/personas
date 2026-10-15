/**
 * lanesSnapshotSource — the ONE `decision_lanes_snapshot` read app-wide.
 *
 * Shape of `pendingCountsSource`: one read in flight however many readers are
 * mounted (the command bar's lane buttons, the deck, the Bay lamps, the
 * title-bar badge), the last good snapshot kept, and a failed read remembered
 * until the next success (a failed read is never an empty one).
 *
 * WHO calls `refreshLanesSnapshot`: the roster's counts refresh
 * (`useDecisionCountsCore.refreshCounts`), so the 30 s coordinator tick, the
 * roster's push events and a landed verdict all re-read it; and every
 * `charter-act-recorded` event (`useLanesSnapshot`). Only while the setting
 * is `lanes`: under `chips` nobody reads it.
 *
 * Module state, read through `useSyncExternalStore`; the test hatch resets it.
 */
import { getDecisionLanesSnapshot } from '@/api/mandates';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import { silentCatch } from '@/lib/silentCatch';

export interface LanesSnapshotState {
  /** The last snapshot that landed, or null before any. */
  snapshot: DecisionLanesSnapshot | null;
  /** The last read failed. `snapshot` is the last good answer. */
  failed: boolean;
  /** At least one read has settled. */
  settled: boolean;
}

let state: LanesSnapshotState = { snapshot: null, failed: false, settled: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: LanesSnapshotState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeLanesSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLanesSnapshotState(): LanesSnapshotState {
  return state;
}

/** Read the snapshot once. Never rejects: the failure is the state. */
export function refreshLanesSnapshot(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = getDecisionLanesSnapshot()
    .then((snapshot) => publish({ snapshot, failed: false, settled: true }))
    .catch((err: unknown) => {
      // Background read: never toasts. The lane buttons say it failed instead.
      silentCatch('decisionCenter.lanesSnapshot')(err);
      publish({ ...state, failed: true, settled: true });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test hatch — module state must not leak between tests. */
export function resetLanesSnapshotSource(): void {
  state = { snapshot: null, failed: false, settled: false };
  inFlight = null;
  listeners.clear();
}
