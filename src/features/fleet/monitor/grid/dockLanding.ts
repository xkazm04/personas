// dockLanding — the Launch Rail's fourth pre-flight reading: WHERE IN THE LINE
// this dispatch lands, read off the queue snapshot the Monitor already holds.
//
// ## What is a fact here, and what is not
//
// The operator's complaint was "always goes to last queue position". That half
// is TRUE and provable: `queue.rs::enqueue_into` ranks a new row at
// `max(existing rank) + 1`, so a dispatch that queues always joins the TAIL.
// The position this module reports for a queued dispatch is that tail, and it
// is arithmetic over the snapshot, not a guess.
//
// The other half is a FORECAST and is labelled as one. The admission door
// (`queue.rs::door_verdict_for`) can still take the `Door::Start` branch while
// rows wait — it calls that a BACKFILL, counts a skip against every row it
// passes, and suspends it only when an aged row is waiting. It can also queue
// a dispatch that looks admissible, because a budget hold the snapshot does
// not expose is what actually decides. So:
//
// > **This module never claims a dispatch will start.** It states what the
// > snapshot proves (slots in use, rows waiting, the tail position) and leaves
// > the verdict to the door.
//
// That asymmetry is deliberate and it is the `client-rule-mirroring` golden
// path's P6 (a mirror must fail closed): the one direction we assert — "the
// fleet is full, so this waits at the tail" — is the RESTRICTIVE answer, and
// the permissive one ("it starts now") is never asserted, only described in
// the tooltip's prose. Prose cannot branch wrongly; a second copy of
// `door_verdict_for` could. Do not grow this file into one.

import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';

export type DockLanding =
  /** No snapshot has landed yet — the dock says nothing rather than guessing. */
  | { kind: 'unknown' }
  /** Under the cap with an empty queue: nothing for this dispatch to wait behind. */
  | { kind: 'room'; running: number; cap: number }
  /** Under the cap with rows waiting: the door may backfill this past them. */
  | { kind: 'ahead'; waiting: number; running: number; cap: number }
  /** At or over the cap: this joins the tail, at `position`. */
  | { kind: 'wait'; position: number; cap: number };

/**
 * Read the landing off a queue snapshot. Pure; the hook is a memo over it and
 * the tests drive the function.
 */
export function dockLanding(snapshot: FleetQueueSnapshot | null | undefined): DockLanding {
  if (!snapshot) return { kind: 'unknown' };
  const { cap, running, queued } = snapshot;
  // A cap of zero admits nothing, so it reads as full like any other full
  // fleet rather than as "room" by arithmetic accident.
  if (running >= cap) return { kind: 'wait', position: queued + 1, cap };
  if (queued > 0) return { kind: 'ahead', waiting: queued, running, cap };
  return { kind: 'room', running, cap };
}
