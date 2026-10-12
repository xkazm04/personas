/**
 * pendingCountsSource — the roster's one `dev_tools_pending_counts` read, with
 * the failure the store's slice throws away.
 *
 * `devToolsTriageSlice.refreshPendingCounts` swallows a failed read and keeps
 * the last tally — right for a badge, but it leaves no trace that the read
 * failed, and the roster's contract is that a chip whose source did not answer
 * says so instead of showing a number. So the roster reads through here:
 *
 *  - one in-flight read at a time, however many rosters are mounted (the strip,
 *    the modal, the orb all read the same answer);
 *  - a success is written into the system store's `pendingCounts`, so the
 *    title-bar badge and every other reader of that field move with it rather
 *    than lagging up to a poll behind;
 *  - a failure is remembered here, and cleared by the next success.
 *
 * Module state, read through `useSyncExternalStore`; the test hatch resets it.
 */
import * as devApi from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

export interface PendingCountsStatus {
  /** The last read failed. The counts in the store are the last good answer. */
  failed: boolean;
  /** At least one read (by anyone) has settled. */
  settled: boolean;
}

let status: PendingCountsStatus = { failed: false, settled: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: PendingCountsStatus): void {
  if (next.failed === status.failed && next.settled === status.settled) return;
  status = next;
  for (const listener of listeners) listener();
}

export function subscribePendingCountsStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingCountsStatus(): PendingCountsStatus {
  return status;
}

/** Read the counts once. Never rejects: the failure is the status. */
export function refreshDecisionCounts(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = devApi
    .pendingCounts()
    .then((pendingCounts) => {
      useSystemStore.setState({ pendingCounts });
      publish({ failed: false, settled: true });
    })
    .catch((err: unknown) => {
      // Background read: never toasts. The chip says it failed instead.
      silentCatch('decisionCenter.pendingCounts')(err);
      publish({ failed: true, settled: true });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test hatch — module state must not leak between tests. */
export function resetPendingCountsSource(): void {
  status = { failed: false, settled: false };
  inFlight = null;
  listeners.clear();
}
