// PORTED from bp apps/web/src/engine/Engine.ts @ 93f30b0 (spark bp-sync, WP2): readyScope, what G reads. Pure.
// EDIT (port): bp reads its own UI state (S.tgt lasso, S.open, the camera's place chain); here the caller passes the
// sheet's picked work items (resolved to their features), the open L4 sheet and the level snapshot's chain. bp's
// milestone scope (`ms`, its GA milestone) is OUT for v1: Personas has no milestone scope kind. bp's English label
// ("<name> wing", "N selected", "The whole product") becomes structured `label` data for the text hook.
// Readiness for any scope: the multi-selection, else the open feature, else the room in view (a bay is a part of a
// room), else its wing, else the whole product. Resolved once as readiness opens (bp setMode), so flying the camera
// afterwards never changes what the callout reads.
import type { Layout } from './layout';
import type { ChainIds } from './scope';

export type ReadyScopeKind = 'selection' | 'feature' | 'room' | 'wing' | 'site';
export interface ReadyScope {
  kind: ReadyScopeKind;
  /** The place's or feature's id; the picked feature ids joined with ',' for a selection; '' for the site. */
  id: string;
  /** The features readiness reads, in plan order. */
  ids: string[];
  /** What the callout names: the place or feature name (the building's for the site), the wing letter, the count. */
  label: { name: string; letter: string | null; n: number };
}

export interface ReadyScopeInput {
  /** The features of the picked work items (the multi-selection), in pick order; duplicates are fine. */
  picked: readonly string[];
  /** The feature whose L4 sheet is open, or null. */
  sheet: string | null;
  /** What the camera is over (the level snapshot's chain). */
  chain: ChainIds;
}

/** The scope `g` reads, by bp's priority; null on a map with no features. */
export function readyScopeOf(L: Layout, inp: ReadyScopeInput): ReadyScope | null {
  const picked = [...new Set(inp.picked)].filter((id) => L.TILE[id]);
  if (picked.length) {
    const one = picked.length === 1 ? L.TILE[picked[0]!]! : null;
    return { kind: 'selection', id: picked.join(','), ids: picked, label: { name: one ? one.f.name : '', letter: null, n: picked.length } };
  }
  const T = inp.sheet ? L.TILE[inp.sheet] : undefined;
  if (T) return { kind: 'feature', id: T.id, ids: [T.id], label: { name: T.f.name, letter: null, n: 1 } };
  const R = inp.chain.room ? L.ROOM[inp.chain.room] : inp.chain.bay ? L.BAY[inp.chain.bay]?.room : undefined;
  if (R && R.feats.length) return { kind: 'room', id: R.id, ids: R.feats.map((f) => f.id), label: { name: R.d.name, letter: R.wing.def.letter, n: R.feats.length } };
  const W = inp.chain.wing ? L.WING[inp.chain.wing] : undefined;
  if (W && W.feats.length) return { kind: 'wing', id: W.id, ids: W.feats.map((f) => f.id), label: { name: W.def.name, letter: W.def.letter, n: W.feats.length } };
  const all = L.bld.feats;
  if (!all.length) return null;
  return { kind: 'site', id: '', ids: all.map((f) => f.id), label: { name: L.bld.name, letter: null, n: all.length } };
}
