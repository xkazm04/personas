// PORTED from bp apps/web/src/engine/place-words.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no canvas, no DOM, no React.
// EDIT (port): bp reads the Engine (E.M, E.placeById, E.lensAgg) and builds English (kick, sub, parts, name). Here
// placeWords takes the Layout and the lens registry and returns STRUCTURED parts: the place's names, its stage counts on
// the date, the lens part as data (the rollup verdict, bad and to-watch counts: the same figures engine/labels.ts
// aggParts draws, since Personas has no manifest place aggregate like bp's LensChannel.aggregate), the bad count and the
// first bad feature with its reason. placeSentence / placeParts take a words object so the text hook supplies t.*.
// Stage counts come from engine/travel.ts (stageOfAt, countsAt, deltaWin), health counts from model/aggregates.ts.
// Personas has one building and no wing art, so bp's multi-building kicker and the wing's art key are left out.
// What a place says: the hover card's place summary and the sentence the plan's live region speaks when the camera
// rests on a place (a room walk, a zoom, a lens switch). One pure function, so the card a mouse reader sees and the
// sentence a screen reader hears are the same facts.
import type { Feature, LensDef } from '../standard/load';
import type { Health } from '../standard/types';
import { generalHealth } from '../standard/present';
import { healthOf, type Counts } from '../model/aggregates';
import type { BayNode, BldNode, Layout, PlaceNode, RoomNode, WingNode } from '../model/layout';
import { countsAt, deltaWin, stageOfAt } from './travel';

export type PlaceType = 'bld' | 'wing' | 'room' | 'bay';
/** Stage counts on the date shown, plus `chg`: features whose stage moved within the recent window (bp countsOf). */
export type PlaceCounts = Counts & { chg: number };
/** The card's one line under the name, as data (bp `sub`). */
export type PlaceSub =
  | { kind: 'bld'; wings: number; rooms: number }
  | { kind: 'wing'; plain: string; rooms: string[] }
  | { kind: 'room'; summary: string }
  | { kind: 'bay'; features: string[] };
export interface PlaceWords {
  type: PlaceType;
  id: string;
  /** The place's own name. */
  title: string;
  /** The wing the place is in (the wing itself for a wing), null for the building. */
  wing: { letter: string; name: string } | null;
  /** A bay's room name, else null. */
  room: string | null;
  sub: PlaceSub;
  /** The place's illustration key (a room's or bay's domain base), or null. */
  art: string | null;
  /** Stage counts on the date shown (the card's bar). */
  counts: PlaceCounts;
  /** Under a lens view at now: the lens's place part (rollup verdict, bad, to watch); null under General or off now. */
  lensPart: { rollup: Health; bad: number; watch: number } | null;
  /** Features bad under the view (General: bad overall); 0 on a past date. */
  bad: number;
  /** The first bad feature and its reason under the view, for the sentence; null when none. */
  first: { fid: string; name: string; lens: string; lensName: string; why: string } | null;
  /** The view's lens id and name, or null under General. */
  lens: string | null;
  lensName: string | null;
}

function placeOf(L: Layout, type: PlaceType, id: string): PlaceNode | null {
  if (type === 'wing') return L.WING[id] ?? null;
  if (type === 'room') return L.ROOM[id] ?? null;
  if (type === 'bay') return L.BAY[id] ?? null;
  return L.bld.id === id ? L.bld : null;
}

/** A place's summary under a view on a date (`delta`: the stage-change window, as the card counts it); null for an unknown place. */
export function placeWords(L: Layout, lenses: { LENS: Readonly<Record<string, Pick<LensDef, 'name'>>> }, type: PlaceType, id: string, view: string, t: string, asOf: string, delta: number): PlaceWords | null {
  const o = placeOf(L, type, id); if (!o) return null;
  const now = t >= asOf;
  let title: string, wing: PlaceWords['wing'] = null, room: string | null = null, sub: PlaceSub, art: string | null = null;
  if (type === 'wing') { const w = o as WingNode; title = w.def.name; wing = { letter: w.def.letter, name: w.def.name }; sub = { kind: 'wing', plain: w.def.plain, rooms: w.rooms.map((r) => r.d.name) }; }
  else if (type === 'room') { const r = o as RoomNode; title = r.d.name; wing = { letter: r.wing.def.letter, name: r.wing.def.name }; sub = { kind: 'room', summary: r.d.summary }; art = r.d.base; }
  else if (type === 'bay') { const b = o as BayNode; title = b.cap.name; wing = { letter: b.room.wing.def.letter, name: b.room.wing.def.name }; room = b.room.d.name; sub = { kind: 'bay', features: b.tiles.map((T) => T.f.name) }; art = b.room.d.base; }
  else { const b = o as BldNode; title = b.name; sub = { kind: 'bld', wings: b.wings.length, rooms: b.wings.reduce((n, w) => n + w.rooms.length, 0) }; }
  const feats: readonly Feature[] = o.feats;
  const at = now ? null : t;
  const counts: PlaceCounts = { ...countsAt(feats, (f) => stageOfAt(f, at, asOf)), chg: feats.reduce((n, f) => n + (deltaWin(f, t, delta) ? 1 : 0), 0) };
  const lensDef = view === 'general' ? undefined : lenses.LENS[view];
  const lens = lensDef ? view : null;
  let lensPart: PlaceWords['lensPart'] = null;
  if (lens && now) {
    const hc = healthOf(feats, lens);
    lensPart = { rollup: generalHealth(feats.map((f) => f.lens[lens]?.h ?? 'unmeasured')), bad: hc.bad, watch: hc.watch };
  }
  const bad = now ? healthOf(feats, lens).bad : 0;
  let first: PlaceWords['first'] = null;
  if (bad) for (const f of feats) {
    const tr = lens === null ? (f.health === 'bad' ? f.trouble.find((x) => x.h === 'bad') : undefined) : f.trouble.find((x) => x.lens === lens && x.h === 'bad');
    if (tr) { first = { fid: f.id, name: f.name, lens: tr.lens, lensName: lenses.LENS[tr.lens]?.name ?? tr.lens, why: tr.why }; break; }
  }
  return { type, id, title, wing, room, sub, art, counts, lensPart, bad, first, lens, lensName: lensDef ? lensDef.name : null };
}

/**
 * The words placeParts / placeSentence need. Same names (and forms) as EngineWords where it has them, so the engine's
 * words object serves. bp's English: "12 features", "7 live", "2 building", "1 on paper", "1 bad", "5 to watch";
 * name: "Room Payments · wing B", "Bay Checkout · room Payments", "Wing B Money", "Building Kettle";
 * inTroubleUnder: "3 in trouble" / "3 in trouble under Security".
 */
export interface PlaceSentenceWords {
  featuresN(n: number): string;
  live(n: number): string;
  building(n: number): string;
  onPaper(n: number): string;
  verdict(h: Health): string;
  bad(n: number): string;
  toWatch(n: number): string;
  placeName(w: PlaceWords): string;
  inTroubleUnder(n: number, lensName: string | null): string;
}

/** "12 features" then the lens's own parts (a lens view at now), else the stage parts (bp `parts`). */
export function placeParts(w: PlaceWords, W: PlaceSentenceWords): string[] {
  const n = W.featuresN(w.counts.n);
  if (w.lensPart) {
    const p = [n, W.verdict(w.lensPart.rollup).toLowerCase()];
    if (w.lensPart.bad) p.push(W.bad(w.lensPart.bad));
    if (w.lensPart.watch) p.push(W.toWatch(w.lensPart.watch));
    return p;
  }
  const c = w.counts;
  return [n, W.live(c.live + c.flagged), W.building(c.build), W.onPaper(c.paper)];
}

/** The spoken sentence: "Room Payments · wing B · 12 features · … · 3 in trouble under Security: Card vault, 2 secrets found". */
export function placeSentence(w: PlaceWords, W: PlaceSentenceWords): string {
  let s = W.placeName(w) + ' · ' + placeParts(w, W).join(' · ');
  if (w.bad) {
    s += ' · ' + W.inTroubleUnder(w.bad, w.lensName);
    if (w.first) s += ': ' + w.first.name + ', ' + (w.lens ? '' : w.first.lensName + ': ') + w.first.why;
  }
  return s;
}
