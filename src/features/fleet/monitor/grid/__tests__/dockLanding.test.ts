// dockLanding — what the Launch Rail is allowed to claim about the queue.
//
// The point of these assertions is not the arithmetic (it is three lines); it
// is the BOUNDARY. The admission door is a sibling's file and the only verdict
// this module may assert is the restrictive one, so the tests below are mostly
// about what it must NOT say.

import { describe, expect, it } from 'vitest';
import { dockLanding } from '../dockLanding';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';

const snap = (
  cap: number,
  running: number,
  queued: number,
  strictOrder = false,
): FleetQueueSnapshot => ({
  cap,
  running,
  queued,
  overAdmitted: Math.max(0, running - cap),
  entries: [],
  budgets: {} as FleetQueueSnapshot['budgets'],
  strictOrder,
});

describe('dockLanding', () => {
  it('says nothing at all before the first queue read', () => {
    expect(dockLanding(null)).toEqual({ kind: 'unknown' });
    expect(dockLanding(undefined)).toEqual({ kind: 'unknown' });
  });

  it('reports room when the fleet is under its cap with an empty queue', () => {
    expect(dockLanding(snap(10, 3, 0))).toEqual({ kind: 'room', running: 3, cap: 10 });
  });

  it('puts a queued dispatch at the TAIL, which is what enqueue_into guarantees', () => {
    // Four waiting rows and a full fleet: the fifth is the new one.
    expect(dockLanding(snap(4, 4, 4))).toEqual({ kind: 'wait', position: 5, cap: 4 });
  });

  it('names the backfill rather than promising a start', () => {
    // Under the cap WITH rows waiting: the door may start this one first, and
    // the dock reports what it is about to pass, not that it will pass them.
    expect(dockLanding(snap(10, 2, 3))).toEqual({ kind: 'ahead', waiting: 3, running: 2, cap: 10 });
  });

  it('treats an over-admitted fleet as full, not as room', () => {
    // `fleet_queue_start_now` can push the fleet past its own cap. Reading
    // that as room would be the permissive answer; a mirror fails closed.
    expect(dockLanding(snap(4, 6, 1))).toEqual({ kind: 'wait', position: 2, cap: 4 });
  });

  it('treats a cap of zero as full rather than as room by arithmetic accident', () => {
    expect(dockLanding(snap(0, 0, 0))).toEqual({ kind: 'wait', position: 1, cap: 0 });
  });

  it('stops naming a backfill once strict queue order is on', () => {
    // The same snapshot that reads "ahead of 3" with the setting off. With it
    // on the door defers behind a row that could start now, so "ahead" would
    // be the permissive answer to a question the door now answers the other
    // way - the one claim this module promised never to make.
    expect(dockLanding(snap(10, 2, 3, true))).toEqual({
      kind: 'strict',
      position: 4,
      waiting: 3,
    });
  });

  it('still reports room under strict order when nothing is waiting', () => {
    // Strict order only ever narrows `ahead` into a wait. With an empty queue
    // there is no turn to wait for and the door starts the dispatch.
    expect(dockLanding(snap(10, 3, 0, true))).toEqual({ kind: 'room', running: 3, cap: 10 });
  });

  it('keeps the cap verdict ahead of the strict one, since the cap says more', () => {
    expect(dockLanding(snap(4, 4, 4, true))).toEqual({ kind: 'wait', position: 5, cap: 4 });
  });
});
