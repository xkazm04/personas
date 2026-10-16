/**
 * cardShape — which of the mandate lanes' card shapes an item takes, from
 * the lane the router gave it. React-free.
 *
 *   sign     a draft mandate (`kind: 'mandate'`): the envelope document
 *   valve    Breach / `valve`: one irreversible item, armed twice, never batched
 *   breach   any other Breach item (not a build question, whose answer fields
 *            ARE its decision): clause, items behind it, amend / deny / suspend
 *   claim    a goal claim in Accept: met-when checklist and audit sample
 *   lens     a lens-scan card (build, evidence, release; spark one-control):
 *            its verdicts are printed and disabled, its one gesture opens the
 *            blueprint (or the release composition); it never writes
 *   default  everything else keeps the shape of its modal type
 *
 * Shapes exist only where the lanes snapshot routed the item; a deck opened
 * from a chip (no snapshot) deals every card in its default shape.
 *
 * The digit keys of a shape: breach takes 1-3 (amend, deny, suspend) and a
 * claim 1-3 (pick an audited act), so the item's own branches move up by
 * `BRANCH_OFFSET` (4, 5, ...) and never collide.
 */
import type { LaneClause } from '@/lib/bindings/LaneClause';

import type { DecisionItem } from '../../model/decisionModel';
import { isLensKind } from '../../lens/lensKinds';
import { laneOfItem, type LaneIndex } from '../../lanes/laneModel';
import type { Lane } from '@/lib/bindings/Lane';

export type CardShape = 'sign' | 'breach' | 'valve' | 'claim' | 'lens' | 'default';

export interface ShapeRoute {
  lane: Lane;
  clause: LaneClause;
  charterId: string | null;
}

export function routeOf(item: DecisionItem, lanes: LaneIndex): ShapeRoute | null {
  const fixed = laneOfItem(item, lanes);
  if (!fixed) return null;
  return { lane: fixed.lane, clause: fixed.clause, charterId: lanes.get(item.id)?.charterId ?? null };
}

export function shapeOf(item: DecisionItem, route: ShapeRoute | null): CardShape {
  if (item.kind === 'mandate') return 'sign';
  // Before any route: a lens-scan card never takes a writing shape, wherever it is dealt.
  if (isLensKind(item.kind)) return 'lens';
  if (!route) return 'default';
  if (route.lane === 'breach') {
    if (route.clause === 'valve') return 'valve';
    return item.input ? 'default' : 'breach';
  }
  if (route.lane === 'accept' && item.kind === 'goal') return 'claim';
  return 'default';
}

export const BRANCH_OFFSET: Record<CardShape, number> = { sign: 0, valve: 0, default: 0, lens: 0, breach: 3, claim: 3 };

/** "3 of 48": this valve's place among the valves of the queue. */
export function valveStep(queue: readonly DecisionItem[], item: DecisionItem, lanes: LaneIndex): { index: number; total: number } {
  const valves = queue.filter((q) => routeOf(q, lanes)?.clause === 'valve' && routeOf(q, lanes)?.lane === 'breach');
  return { index: valves.findIndex((q) => q.id === item.id) + 1, total: valves.length };
}

/** The other queue items the router coalesced with this one (same mandate, lane and clause). */
export function behindIt(queue: readonly DecisionItem[], item: DecisionItem, lanes: LaneIndex): DecisionItem[] {
  const key = lanes.get(item.id)?.coalesceKey;
  if (!key || key === item.id) return [];
  return queue.filter((q) => q.id !== item.id && lanes.get(q.id)?.coalesceKey === key);
}

/**
 * Items as a lane deck deals them: an item whose adapter could not say what
 * leaves takes the snapshot's `irreversible` (derived on the backend from a
 * closed source, never guessed), so a valve or a merge arms in the deck even
 * when its row carries no such field on the frontend. An adapter's own value
 * wins. The same array comes back when nothing changes.
 */
export function withLaneIrreversible(items: DecisionItem[], lanes: LaneIndex): DecisionItem[] {
  let changed = false;
  const out = items.map((i) => {
    const irr = i.irreversible ? null : lanes.get(i.id)?.irreversible;
    if (!irr) return i;
    changed = true;
    return { ...i, irreversible: irr };
  });
  return changed ? out : items;
}
