// The engine's two style profiles.
//
// `classic` is the field as it has shipped: every function in this engine
// behaves exactly as it did before profiles existed when it is asked for
// `classic`, and the galaxy tests that predate this file are the proof.
//
// `fused` is the field under the promoted Council HUD (contest
// council-hud-r2-r3, owner-chosen 2026-09-23). It changes four paint rules
// and nothing else, all four from the round-2 Bezel's field engine, which the
// owner named in the fusion ("the label pass that never covers a node"):
//
//  1. the label pass tries eight spots round each node and treats every star
//     and technique dot on screen as an obstacle, then a two-line name, then
//     the rank number; a label is counted as hidden only when even the number
//     has no room (`labelsFused.ts`);
//  2. one level is named at a time: the sky names domains, a domain names its
//     categories, a category its subjects, a subject its techniques, and the
//     node the reader stands on is not named again in the field;
//  3. no halo and no ring is drawn wider than half the gap to the star's
//     nearest neighbour, so nodes never overlap at any altitude;
//  4. the claim colours are read from `--gx-ok`, `--gx-err`, `--gx-warn` and
//     `--gx-none`, defined once in `fused/fused.css`, so a star, its bar in
//     the cross-section and its arc on the bezel are the same colour.
import type { GalaxyLayout, SubjectNode } from './types';

export type StyleProfile = 'classic' | 'fused';

const GAPS = new WeakMap<GalaxyLayout, Map<SubjectNode, number>>();

/**
 * Distance, in WORLD units, from every star to its nearest neighbour.
 *
 * Computed once per layout and cached against it: 471 stars is ~110k pairs,
 * which is nothing once and far too much per frame.
 */
export function nearestGaps(layout: GalaxyLayout): Map<SubjectNode, number> {
  const cached = GAPS.get(layout);
  if (cached) return cached;
  const out = new Map<SubjectNode, number>();
  const all = layout.subjects;
  for (const s of all) {
    let best = Infinity;
    for (const o of all) {
      if (o === s) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < best) best = d;
    }
    out.set(s, best);
  }
  GAPS.set(layout, out);
  return out;
}

/**
 * The widest any decoration of a star may reach, in SCREEN pixels: half the
 * gap to its nearest neighbour, never inside the star's own ink plus a hair.
 */
export function decorationCap(inkR: number, nearestWorld: number, k: number, magnification = 1): number {
  const half = Number.isFinite(nearestWorld) ? 0.5 * nearestWorld * k * magnification : Infinity;
  return Math.max(inkR + 1.5, half);
}

/** The CSS variables the fused profile reads its claim colours from. */
export const CLAIM_TOKENS: Record<StyleProfile, { ok: string; err: string; pend: string; none: string | null }> = {
  classic: { ok: '--status-success', err: '--status-error', pend: '--status-pending', none: null },
  fused: { ok: '--gx-ok', err: '--gx-err', pend: '--gx-warn', none: '--gx-none' },
};
