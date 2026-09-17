// useQueuePoll — the queue's reconcile poll, owned by the board.
//
// The store is event-driven (`fleet-queue-changed`, session-state flips) and
// that is what keeps the board live; this poll is the safety net for the
// event the board never got — an app that slept, a listener that attached
// late, a door that promoted a row while the webview was hidden. Sixty
// seconds, through the shared `usePolling` coordinator (one heartbeat, pauses
// while the tab is hidden), and ONLY while the Activity board is mounted —
// the slice never polls on its own, because a Monitor that is closed has no
// reader for the answer.

import { useSystemStore } from '@/stores/systemStore';
import { usePolling } from '@/hooks/utility/timing/usePolling';

const QUEUE_RECONCILE_MS = 60_000;

export function useQueuePoll(enabled: boolean): void {
  const refresh = useSystemStore((s) => s.fleetQueueRefresh);
  usePolling(refresh, { interval: QUEUE_RECONCILE_MS, enabled, name: 'fleet-queue-reconcile' });
}
