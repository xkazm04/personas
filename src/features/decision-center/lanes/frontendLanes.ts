/**
 * frontendLanes — the lane of the kinds the backend never sees.
 *
 * `decision_lanes_snapshot` routes every pending row the Rust side can read.
 * Some kinds of decision item have no row: a halted CLI's build questions live
 * in `buildSessions` state, chat threads awaiting a reply are derived from
 * the channel slices, and the lens-scan cards (`build`, `evidence`, `release`,
 * spark one-control) are derived from `lens_scan_products`, stores outside the
 * app database. Their lanes are fixed, and they are this file.
 *
 * This is the frontend half of `UNSIGNED_LANE` in
 * `src-tauri/engine/src/mandate_router.rs`: the rows for `Question`
 * (Breach, clause `unsigned`), `Message` (Talk, clause `none`), `LensBuild`
 * (Breach, `unsigned`: approving a proposal is a judgment call, as an idea)
 * and `LensEvidence` / `LensRelease` (Accept, `none`: a claim of built work,
 * as a goal claim). No mandate ever acts on a lens-scan card, signed or not.
 * The Rust table is the authority; `frontendLanes.test.ts` reads it at run
 * time and fails the moment the two disagree.
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
  build: { lane: 'breach', clause: 'unsigned' },
  evidence: { lane: 'accept', clause: 'none' },
  release: { lane: 'accept', clause: 'none' },
};

/** The fixed lane of a frontend-derived kind, or null for a kind the snapshot routes. */
export function frontendLaneOf(kind: DecisionKind): FixedLane | null {
  return FRONTEND_LANE[kind] ?? null;
}
