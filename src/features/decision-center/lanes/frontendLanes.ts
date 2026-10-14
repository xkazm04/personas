/**
 * frontendLanes — the lane of the two kinds the backend never sees.
 *
 * `decision_lanes_snapshot` routes every pending row the Rust side can read.
 * Two kinds of decision item have no row: a halted CLI's build questions live
 * in `buildSessions` state, and chat threads awaiting a reply are derived from
 * the channel slices. Their lanes are fixed, and they are this file.
 *
 * This is the frontend half of `UNSIGNED_LANE` in
 * `src-tauri/engine/src/mandate_router.rs`: the rows for `Question`
 * (Breach, clause `unsigned`) and `Message` (Talk, clause `none`). The Rust
 * table is the authority; `frontendLanes.test.ts` reads it at run time and
 * fails the moment the two disagree.
 *
 * React-free and store-free.
 */
import type { Lane } from '@/lib/bindings/Lane';
import type { LaneClause } from '@/lib/bindings/LaneClause';

import type { DecisionKind } from '../model/decisionModel';

export interface FixedLane {
  lane: Lane;
  clause: LaneClause;
}

/** The kinds routed here, never by the snapshot. */
export const FRONTEND_LANE: Readonly<Partial<Record<DecisionKind, FixedLane>>> = {
  question: { lane: 'breach', clause: 'unsigned' },
  message: { lane: 'talk', clause: 'none' },
};

/** The fixed lane of a frontend-derived kind, or null for a kind the snapshot routes. */
export function frontendLaneOf(kind: DecisionKind): FixedLane | null {
  return FRONTEND_LANE[kind] ?? null;
}
