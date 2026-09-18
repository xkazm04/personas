// Fleet dispatch queue — the Monitor's four verbs over the queue the Rust
// admission door keeps (`src-tauri/src/commands/fleet/queue.rs`).
//
// The queue itself is the registry's `queued` rows: a session that was
// admitted at the cap keeps its id, its task and who asked for it, and starts
// on its own when a slot frees. These calls only READ the queue and move rows
// within it — nothing here spawns. `fleet-queue-changed` announces every
// mutation, so a caller never has to re-read after writing; the store's
// listener does.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';

/** The queue as the Monitor reads it: cap, live count, over-admission, and
 *  every queued row with its rank, origin and estimated start. */
export const fleetQueueSnapshot = () => invoke<FleetQueueSnapshot>('fleet_queue_snapshot');

/**
 * Re-rank the queue. `sessionIds` is the FULL ordered list of queued session
 * ids — rank 1 first. Ids the queue does not hold are ignored; queued rows the
 * list omits keep their relative order after the listed ones.
 */
export const fleetQueueReorder = (sessionIds: string[]) =>
  invoke<null>('fleet_queue_reorder', { sessionIds });

/** Drop a queued session before it ever starts. Ranks below it close up. */
export const fleetQueueCancel = (sessionId: string) =>
  invoke<null>('fleet_queue_cancel', { sessionId });

/**
 * Promote a queued session past the cap right now. The fleet goes
 * over-admitted by one (`FleetQueueSnapshot.overAdmitted`) until a live
 * session ends; the door does not refill that slot.
 */
export const fleetQueueStartNow = (sessionId: string) =>
  invoke<null>('fleet_queue_start_now', { sessionId });
