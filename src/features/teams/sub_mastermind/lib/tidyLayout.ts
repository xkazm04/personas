// Relation-aware "Tidy map" layout — pure, deterministic, one-shot. Spiral
// placement (hex.spiralPlace) ignores structure, so at 30+ projects integrated
// apps land far apart and routes crisscross. Tidy runs a BOUNDED force pass
// (spring-electrical: edges attract, all pairs repel) ONCE, then a bounded
// overlap-resolution pass, and snaps to the result — NO continuous simulation
// (repo animation-austerity rule).
//
// Determinism: no Date / Math.random anywhere. Island order is slug-sorted, the
// only tie-break for coincident points is hash01(slug) from hex.ts, so identical
// input always yields identical output.
//
// Pinned islands (user-moved — present in the positions store) are ANCHORS: they
// exert forces on others but never move. See `PINNED` note below for where an
// "include pinned" variant would hook in.
import { hash01 } from './hex';

export interface TidyIsland { slug: string; x: number; y: number; }
export interface TidyEdge { from: string; to: string; strength: number; }
/** A group constraint — its members are pulled toward their shared centroid so
 *  they stay contiguous after the tidy. */
export interface TidyGroup { members: string[]; }

export interface TidyInput {
  islands: TidyIsland[];
  edges: TidyEdge[];
  /** Slugs that must not move (user-pinned). */
  pinned?: Set<string>;
  groups?: TidyGroup[];
  /** Force iterations (clamped to [1, 120]). */
  iterations?: number;
}

export type TidyResult = Record<string, { x: number; y: number }>;

// Island footprints are ~900×800 world units; keep a gap so nothing overlaps at
// default fit zoom. Connected neighbours settle ~one footprint + gap apart, far
// enough that even a 45° placement clears both separation axes.
export const FOOTPRINT = { w: 900, h: 800, gap: 120 } as const;
const SEP_X = FOOTPRINT.w + FOOTPRINT.gap; // 1020
const SEP_Y = FOOTPRINT.h + FOOTPRINT.gap; // 920
const IDEAL_LINK = 1350;
const MAX_ITERS = 120;
const MAX_OVERLAP_PASSES = 80;
const COHESION = 0.08;

/** True when two island centres are close enough that their footprints overlap. */
export function islandsOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < SEP_X && Math.abs(a.y - b.y) < SEP_Y;
}

const bySlugAsc = (a: { slug: string }, b: { slug: string }) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

export function tidyLayout(input: TidyInput): TidyResult {
  const pinned = input.pinned ?? new Set<string>();
  const groups = input.groups ?? [];
  const iters = Math.max(1, Math.min(input.iterations ?? MAX_ITERS, MAX_ITERS));

  const islands = [...input.islands].sort(bySlugAsc);
  const pos = new Map<string, { x: number; y: number }>();
  for (const i of islands) pos.set(i.slug, { x: i.x, y: i.y });
  const known = new Set(islands.map((i) => i.slug));
  const isPinned = (s: string) => pinned.has(s);

  const edges = input.edges
    .filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to)
    .map((e) => ({ from: e.from, to: e.to, strength: Math.max(0.2, Math.min(1, e.strength || 1)) }))
    .sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));

  // Coincident points get a deterministic tiny nudge so repulsion has a direction.
  const separate = (a: string, b: string) => {
    const ang = hash01(a + '|' + b) * Math.PI * 2;
    return { x: Math.cos(ang) * 0.5, y: Math.sin(ang) * 0.5 };
  };

  const k = IDEAL_LINK;
  let temp = IDEAL_LINK * 1.5;
  const tempMin = IDEAL_LINK * 0.02;
  const cool = Math.pow(tempMin / temp, 1 / iters);

  for (let it = 0; it < iters; it++) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const i of islands) disp.set(i.slug, { x: 0, y: 0 });

    // Repulsion — every pair pushes apart (Fruchterman-Reingold k²/d).
    for (let a = 0; a < islands.length; a++) {
      const A = islands[a]!.slug;
      for (let b = a + 1; b < islands.length; b++) {
        const B = islands[b]!.slug;
        const pa = pos.get(A)!, pb = pos.get(B)!;
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-6) { const s = separate(A, B); dx = s.x; dy = s.y; dist = 0.5; }
        const f = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist;
        const da = disp.get(A)!, db = disp.get(B)!;
        da.x += ux * f; da.y += uy * f;
        db.x -= ux * f; db.y -= uy * f;
      }
    }

    // Attraction — connected islands pull together (d²/k), scaled by strength.
    for (const e of edges) {
      const pa = pos.get(e.from)!, pb = pos.get(e.to)!;
      const dx = pa.x - pb.x, dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy) || 1e-6;
      const f = ((dist * dist) / k) * e.strength;
      const ux = dx / dist, uy = dy / dist;
      const da = disp.get(e.from)!, db = disp.get(e.to)!;
      da.x -= ux * f; da.y -= uy * f;
      db.x += ux * f; db.y += uy * f;
    }

    // Group cohesion — members drift toward their shared centroid (contiguity).
    for (const g of groups) {
      const members = g.members.filter((s) => known.has(s));
      if (members.length < 2) continue;
      let cx = 0, cy = 0;
      for (const s of members) { const p = pos.get(s)!; cx += p.x; cy += p.y; }
      cx /= members.length; cy /= members.length;
      for (const s of members) {
        const p = pos.get(s)!, d = disp.get(s)!;
        d.x += (cx - p.x) * COHESION * k * 0.001;
        d.y += (cy - p.y) * COHESION * k * 0.001;
      }
    }

    // Apply, capped by temperature; pinned islands are fixed anchors.
    for (const i of islands) {
      if (isPinned(i.slug)) continue; // PINNED: an "include pinned" variant would drop this guard.
      const d = disp.get(i.slug)!;
      const len = Math.hypot(d.x, d.y) || 1;
      const step = Math.min(len, temp);
      const p = pos.get(i.slug)!;
      p.x += (d.x / len) * step;
      p.y += (d.y / len) * step;
    }
    temp *= cool;
  }

  resolveOverlaps(islands, pos, isPinned);

  const out: TidyResult = {};
  for (const i of islands) { const p = pos.get(i.slug)!; out[i.slug] = { x: p.x, y: p.y }; }
  return out;
}

/** Bounded, deterministic separation pass: push overlapping pairs apart along
 *  the axis of least penetration until no footprints overlap (or the pass cap). */
function resolveOverlaps(
  islands: TidyIsland[],
  pos: Map<string, { x: number; y: number }>,
  isPinned: (s: string) => boolean,
): void {
  for (let pass = 0; pass < MAX_OVERLAP_PASSES; pass++) {
    let moved = false;
    for (let a = 0; a < islands.length; a++) {
      const A = islands[a]!.slug;
      for (let b = a + 1; b < islands.length; b++) {
        const B = islands[b]!.slug;
        const pa = pos.get(A)!, pb = pos.get(B)!;
        const dx = pa.x - pb.x, dy = pa.y - pb.y;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        if (adx >= SEP_X || ady >= SEP_Y) continue; // not overlapping
        const pinA = isPinned(A), pinB = isPinned(B);
        if (pinA && pinB) continue; // both fixed — user's explicit layout wins
        const ox = SEP_X - adx, oy = SEP_Y - ady;
        // Sign of the push; a dead-centre collision picks a stable hashed axis dir.
        const sx = dx !== 0 ? Math.sign(dx) : (hash01(A + B) < 0.5 ? 1 : -1);
        const sy = dy !== 0 ? Math.sign(dy) : (hash01(B + A) < 0.5 ? 1 : -1);
        // Split the correction (whole shove onto the single free end if one is pinned).
        const shareA = pinB ? 1 : pinA ? 0 : 0.5;
        const shareB = 1 - shareA;
        if (ox <= oy) {
          pa.x += sx * ox * shareA; pb.x -= sx * ox * shareB;
        } else {
          pa.y += sy * oy * shareA; pb.y -= sy * oy * shareB;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}
