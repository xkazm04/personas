// The chronological plan layout in world units, PORTED from bp src/lib/model/layout.ts @ fbef867 for one
// building (a live product is scale 1). Wings run left to right in the order their work began (median
// creation date), one wing per domain; inside a bay, features sit oldest first. The plan is computed once per
// product and never moves: lenses, time and decisions change what places say, not where they are.
// EDIT (port): bp's Kettle-only named wings (WING_DEFS) are dropped on purpose, so the Kettle fixture takes
// the path every live product takes.
import type { Capability, Domain, Feature, Structure } from '../standard/load';

export const TW = 160, TH = 76, G = 10, BH = 46, RH = 72, PAD = 16, BB = 12;

export interface Box { x: number; y: number; w: number; h: number }
export interface WingDef { k: string; name: string; plain: string; doms: string[]; letter: string; median: number; code: string }
export interface BldNode extends Box { kind: 'bld'; id: string; name: string; wings: WingNode[]; feats: Feature[] }
export interface WingNode extends Box { kind: 'wing'; id: string; def: WingDef; bld: BldNode; rooms: RoomNode[]; feats: Feature[]; cols: number }
export interface RoomNode extends Box {
  kind: 'room'; id: string; d: Domain; wing: WingNode; bays: BayNode[]; feats: Feature[]; ri: number;
  /** The drawn label's box (world units), set by the renderer; null when no label is drawn. Trouble flags step aside from it. */
  labelBox: Box | null;
}
export interface BayNode extends Box { kind: 'bay'; id: string; cap: Capability; room: RoomNode; tiles: TileNode[]; feats: Feature[]; rib: Box }
export interface TileNode extends Box { kind: 'tile'; id: string; f: Feature; bay: BayNode; room: RoomNode; wing: WingNode; idx: number; bi: number; ti: number }
export type PlaceNode = BldNode | WingNode | RoomNode | BayNode;

export interface Layout {
  bld: BldNode; wings: WingNode[]; rooms: RoomNode[]; bays: BayNode[]; tiles: TileNode[];
  TILE: Record<string, TileNode>; ROOM: Record<string, RoomNode>; BAY: Record<string, BayNode>; WING: Record<string, WingNode>;
  world: Box;
  wingDefs: WingDef[];
}

export const dnum = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;

/** One wing per domain that has features, ordered by the median creation date of its features, lettered A, B, C. */
export function wingOrder(S: Structure): WingDef[] {
  const used: WingDef[] = S.domains
    .filter((d) => S.features.some((f) => f.domain === d.id))
    .map((d) => {
      const ds = S.features.filter((f) => f.domain === d.id).map((f) => dnum(f.created)).sort((a, b) => a - b);
      return { k: d.id, name: d.name, plain: d.summary || d.name, doms: [d.id], letter: '', median: ds.length ? ds[Math.floor(ds.length / 2)] ?? 0 : 0, code: d.code };
    });
  used.sort((a, b) => a.median - b.median);
  used.forEach((w, i) => { w.letter = String.fromCharCode(65 + i); });
  return used;
}

const bayH = (n: number, c: number) => { const r = Math.ceil(n / c); return BH + r * TH + (r - 1) * G + BB; };
const wingW = (c: number) => 2 * PAD + c * TW + (c - 1) * G;

export function layoutProduct(S: Structure): Layout {
  const C: Record<string, Capability> = Object.fromEntries(S.capabilities.map((c) => [c.id, c]));
  const F: Record<string, Feature> = Object.fromEntries(S.features.map((f) => [f.id, f]));
  const FI: Record<string, number> = Object.fromEntries(S.features.map((f, i) => [f.id, i]));
  const doms = S.domains.filter((d) => d.capabilities.some((id) => C[id]!.features.length));
  const wingDefs = wingOrder(S);
  const roomH = (d: Domain, c: number) => RH + d.capabilities.reduce((a, id) => a + bayH(C[id]!.features.length, c), 0) + PAD;
  const wings = wingDefs
    .map((def) => ({ def, doms: def.doms.map((k) => doms.find((d) => d.id === k)).filter((d): d is Domain => !!d) }))
    .filter((w) => w.doms.length);
  // a target wing height that makes the building about twice as wide as tall, with even wings; a wing's height per
  // column count does not depend on the target, so it is computed once
  const wingH = wings.map((w) => [3, 4, 5, 6].map((c) => w.doms.reduce((a, d) => a + roomH(d, c), 0)));
  let best: { sc: number; cs: number[]; hs: number[]; Hm: number } | null = null;
  for (let Ht = 500; Ht <= 2600; Ht += 20) {
    const cs: number[] = [], hs: number[] = [];
    let W = 0, Hm = 0;
    for (let wi = 0; wi < wings.length; wi++) {
      let bc: { c: number; h: number; sc: number } | null = null;
      for (let c = 3; c <= 6; c++) {
        const h = wingH[wi]![c - 3]!, sc = Math.abs(h - Ht) + c * 8;
        if (!bc || sc < bc.sc) bc = { c, h, sc };
      }
      cs.push(bc!.c); hs.push(bc!.h); W += wingW(bc!.c); Hm = Math.max(Hm, bc!.h);
    }
    const mean = hs.reduce((a, v) => a + v, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / hs.length);
    const sc = Math.abs(Math.log(W / Hm / 2.05)) + 0.8 * sd / Hm;
    if (!best || sc < best.sc - 1e-9) best = { sc, cs, hs, Hm };
  }
  const L: Layout = {
    bld: { kind: 'bld', id: 'B0', name: S.project.name, x: 0, y: 0, w: 0, h: best ? best.Hm : 0, wings: [], feats: [] },
    wings: [], rooms: [], bays: [], tiles: [], TILE: {}, ROOM: {}, BAY: {}, WING: {}, world: { x: 0, y: 0, w: 0, h: 0 }, wingDefs,
  };
  const B = L.bld;
  let x = 0;
  wings.forEach((w, wi) => {
    const c = best!.cs[wi]!, ww = wingW(c);
    let y = 0;
    const Wg: WingNode = { kind: 'wing', id: '0:' + w.def.k, def: w.def, bld: B, x, y: 0, w: ww, h: best!.hs[wi]!, rooms: [], feats: [], cols: c };
    for (const d of w.doms) {
      const rh = roomH(d, c);
      const R: RoomNode = { kind: 'room', id: d.id, d, wing: Wg, x, y, w: ww, h: rh, bays: [], feats: [], ri: L.rooms.length, labelBox: null };
      let by = y + RH, idx = 0;
      for (const cid of d.capabilities) {
        const cap = C[cid]!, bh = bayH(cap.features.length, c);
        if (!cap.features.length) continue;
        const inner = bh - BH - BB, rh2 = Math.min(inner * 0.7, 60);
        const Bay: BayNode = {
          kind: 'bay', id: cid, cap, room: R, x: x + PAD, y: by, w: ww - 2 * PAD, h: bh, tiles: [], feats: [],
          rib: { x: x + PAD + 4, y: by + BH + (inner - rh2) / 2, w: ww - 2 * PAD - 8, h: rh2 },
        };
        // oldest first; features created the same day keep the map's order (stable across slugs and clones)
        cap.features.map((id) => F[id]!).sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : FI[a.id]! - FI[b.id]!)).forEach((f, i) => {
          const T: TileNode = {
            kind: 'tile', id: f.id, f, bay: Bay, room: R, wing: Wg, idx: ++idx, bi: i, ti: L.tiles.length,
            x: Bay.x + (i % c) * (TW + G), y: by + BH + Math.floor(i / c) * (TH + G), w: TW, h: TH,
          };
          Bay.tiles.push(T); L.TILE[f.id] = T; L.tiles.push(T);
          Bay.feats.push(f); R.feats.push(f); Wg.feats.push(f); B.feats.push(f);
        });
        R.bays.push(Bay); L.BAY[cid] = Bay; L.bays.push(Bay); by += bh;
      }
      Wg.rooms.push(R); L.ROOM[d.id] = R; L.rooms.push(R);
      y += rh;
    }
    B.wings.push(Wg); L.wings.push(Wg); L.WING[Wg.id] = Wg; x += ww;
  });
  B.w = x;
  L.world = { x: 0, y: 0, w: B.w, h: B.h };
  return L;
}
