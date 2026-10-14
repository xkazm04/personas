/**
 * laneModel — the mandate lanes as the Decision Center reads them.
 *
 * The routing law is the backend's (`decision_lanes_snapshot`, one Rust
 * function); nothing here re-derives a lane. This module only JOINS the
 * snapshot onto the roster's items (`LaneEntry.itemId === DecisionItem.id`),
 * adds the two frontend-derived kinds (`frontendLanes`), counts, and orders.
 *
 * Four lanes reach the operator (Breach, Sign, Accept, Talk) plus Orphans,
 * which gets its own button. `held` and `evidence` are counts on a charter,
 * never cards; `steward` is the steward's own work.
 *
 * Count law (triage-queues standard): a count is 0 only when its source
 * answered. A failed snapshot read, or any source the snapshot names in
 * `failedSources`, fails every lane the snapshot feeds (any of its kinds can
 * land in Breach as a valve, or in Orphans), and keeps the names for the
 * tooltip. Talk is fed by the chat derivation alone and fails only with it.
 *
 * Order inside a lane: clause rank (stop > valve > risk > merge > spend >
 * scope > unsigned > none), then age (oldest first), then id. "What each item
 * unblocks" is the prototype's second key, but NO field carries it: neither
 * `LaneEntry` nor `DecisionItem` names what an item holds up, so the order
 * skips that key rather than guess it.
 *
 * React-free and store-free.
 */
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { LaneClause } from '@/lib/bindings/LaneClause';
import type { LaneEntry } from '@/lib/bindings/LaneEntry';

import {
  DECISION_CHIPS,
  chipOf,
  type DecisionChip,
  type DecisionItem,
  type DecisionKind,
} from '../model/decisionModel';
import { frontendLaneOf, type FixedLane } from './frontendLanes';

/** The lanes that hold cards for the operator, in button order (keys 1-4). */
export type OperatorLane = 'breach' | 'sign' | 'accept' | 'talk';
export const OPERATOR_LANES: readonly OperatorLane[] = ['breach', 'sign', 'accept', 'talk'];

/** Every lane with a button: the four plus Orphans (key O). */
export type LaneKey = OperatorLane | 'orphan';
export const LANE_KEYS: readonly LaneKey[] = [...OPERATOR_LANES, 'orphan'];

/** The lanes whose cards are the operator's to decide (the Bay's second lamp). */
export const CARD_LANES: readonly OperatorLane[] = ['breach', 'sign', 'accept'];

export interface LaneCount {
  n: number;
  lamp: TriageTone;
  /** The source did not answer; never shown as a number. */
  failed: boolean;
  /** Which sources failed, for the failed mark's tooltip. */
  failedSources: readonly string[];
}

export type LaneCounts = Record<LaneKey, LaneCount>;

/** The snapshot's own name for "the read itself failed". */
export const SNAPSHOT_SOURCE = 'decision_lanes_snapshot';

export interface LaneCountInputs {
  /** The last snapshot that landed, or null before any. */
  snapshot: DecisionLanesSnapshot | null;
  /** The last snapshot read failed outright. */
  snapshotFailed: boolean;
  /** Build questions awaiting input (Breach, frontend-derived). */
  questions: number;
  /** Chat threads awaiting you (Talk, frontend-derived). */
  chat: { n: number; failed: boolean };
}

const CLAUSE_RANK: Record<LaneClause, number> = {
  stop: 0,
  valve: 1,
  risk: 2,
  merge: 3,
  spend: 4,
  scope: 5,
  unsigned: 6,
  none: 7,
};

export function clauseRank(clause: LaneClause): number {
  return CLAUSE_RANK[clause];
}

function isLaneKey(lane: string): lane is LaneKey {
  return (LANE_KEYS as readonly string[]).includes(lane);
}

export function buildLaneCounts(input: LaneCountInputs): LaneCounts {
  const n: Record<LaneKey, number> = { breach: 0, sign: 0, accept: 0, talk: 0, orphan: 0 };
  let stops = 0;
  for (const e of input.snapshot?.items ?? []) {
    if (!isLaneKey(e.lane)) continue;
    n[e.lane] += 1;
    if (e.lane === 'breach' && (e.clause === 'stop' || e.clause === 'valve')) stops += 1;
  }
  n.breach += input.questions;
  n.talk += input.chat.n;

  const failedSources = [
    ...(input.snapshotFailed ? [SNAPSHOT_SOURCE] : []),
    ...(input.snapshot?.failedSources ?? []),
  ];
  // Before the first read lands there is nothing to count yet; that is
  // "loading", not "failed", and the strip shows its ghost until then.
  const snapFailed = failedSources.length > 0;
  const fed = (lane: LaneKey, lit: TriageTone): LaneCount => ({
    n: n[lane],
    lamp: n[lane] > 0 ? lit : 'neutral',
    failed: snapFailed,
    failedSources: snapFailed ? failedSources : [],
  });
  return {
    breach: fed('breach', stops > 0 ? 'danger' : 'warning'),
    sign: fed('sign', 'accent'),
    accept: fed('accept', 'success'),
    talk: {
      n: n.talk,
      lamp: n.talk > 0 ? 'accent' : 'neutral',
      failed: input.chat.failed,
      failedSources: input.chat.failed ? ['chat'] : [],
    },
    orphan: fed('orphan', 'neutral'),
  };
}

/** Breach + Sign + Accept + Talk: what waits on the operator (Orphans excluded). */
export function laneTotal(counts: LaneCounts): number {
  return OPERATOR_LANES.reduce((sum, l) => sum + counts[l].n, 0);
}

/* -- the join -------------------------------------------------------------- */

export type LaneIndex = ReadonlyMap<string, LaneEntry>;

export function indexLanes(snapshot: DecisionLanesSnapshot | null): LaneIndex {
  return new Map((snapshot?.items ?? []).map((e) => [e.itemId, e]));
}

/** An item's lane: fixed for frontend kinds, the snapshot's otherwise, null when unrouted. */
export function laneOfItem(item: DecisionItem, index: LaneIndex): FixedLane | null {
  const fixed = frontendLaneOf(item.kind);
  if (fixed) return fixed;
  const e = index.get(item.id);
  return e ? { lane: e.lane, clause: e.clause } : null;
}

export function compareLaneItems(a: DecisionItem, b: DecisionItem, index: LaneIndex): number {
  const ca = laneOfItem(a, index)?.clause ?? 'none';
  const cb = laneOfItem(b, index)?.clause ?? 'none';
  const rank = clauseRank(ca) - clauseRank(cb);
  if (rank !== 0) return rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The cards one lane deals, in lane order. */
export function laneQueue(lane: LaneKey, items: readonly DecisionItem[], index: LaneIndex): DecisionItem[] {
  return items
    .filter((i) => laneOfItem(i, index)?.lane === lane)
    .sort((a, b) => compareLaneItems(a, b, index));
}

const KIND_CHIP_SAFE = new Set<string>([
  'review', 'question', 'approval', 'policy', 'evolution', 'goal', 'idea', 'incident', 'council', 'report', 'message',
]);

/**
 * The roster chips whose items a lane needs loaded: the chips of every kind
 * the snapshot put in that lane, plus the frontend kinds' own chips. Before a
 * snapshot lands, every chip (the lane cannot be narrowed yet).
 */
export function chipsForLane(lane: LaneKey, snapshot: DecisionLanesSnapshot | null): DecisionChip[] {
  if (!snapshot) return [...DECISION_CHIPS];
  const chips = new Set<DecisionChip>();
  for (const e of snapshot.items) {
    if (e.lane === lane && KIND_CHIP_SAFE.has(e.itemKind)) chips.add(chipOf(e.itemKind as DecisionKind));
  }
  if (lane === 'breach') chips.add('gates');
  if (lane === 'talk') chips.add('chat');
  return DECISION_CHIPS.filter((c) => chips.has(c));
}

/**
 * Cards the operator holds per project (Breach, Sign, Accept, on a mandate):
 * the Bay nameplate's second lamp.
 */
export function cardsByProject(snapshot: DecisionLanesSnapshot | null): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const e of snapshot?.items ?? []) {
    if (!e.projectId || !e.charterId) continue;
    if (!(CARD_LANES as readonly string[]).includes(e.lane)) continue;
    out.set(e.projectId, (out.get(e.projectId) ?? 0) + 1);
  }
  return out;
}
