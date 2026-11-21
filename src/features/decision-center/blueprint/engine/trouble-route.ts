// PORTED from bp apps/web/src/engine/trouble-route.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no canvas, no DOM, no React.
// EDIT (port): bp's walk order `M.L.walk` is `L.rooms.slice()` in bp's layout; Personas' Layout carries no `walk`, so
// routeRank walks `L.rooms` (the same order). routeWords returns a structured RouteArrival instead of bp's English, and
// routeSentence(arrival, words) composes bp's sentence from words the caller supplies (the text hook's t.*). bp's
// ViewId is a string here ('general' or a lens id); `P` is anything with LENS (Plan or Structure).
// The trouble route: N / Shift+N step through the features the current lens marks bad or watch (under General, every
// lens's), in the plan's room-walk order, then bay and tile order inside a room. The route is captured on the first N
// and FROZEN while it is read: a feature that turns bad mid-route is not spliced in (the reader's place would jump);
// it is counted as "N new" and joins when the route is captured again (stepping past either end, or a lens switch).
// Health stays live and separate from the route: an arrival says the feature's health NOW, so a member that
// recovered reads "now good" rather than leaving a hole.
import type { Feature, LensDef } from '../standard/load';
import type { Health } from '../standard/types';
import type { Layout } from '../model/layout';

export interface TroubleRoute {
  /** The view the route was captured under ('general' or a lens id). */
  view: string;
  /** Feature ids in route order. */
  ids: string[];
  has: Set<string>;
  /** The cursor: -1 before the first arrival. */
  i: number;
}

/** Each feature's place in walk order: rooms as the walk orders them, then their bays, then the bay's tiles. */
export function routeRank(L: Pick<Layout, 'rooms'>): Map<string, number> {
  const rank = new Map<string, number>();
  for (const R of L.rooms) for (const B of R.bays) for (const T of B.tiles) if (!rank.has(T.id)) rank.set(T.id, rank.size);
  return rank;
}

/** A frozen route over `members` (the trouble index's list for the view), in walk order; features with no tile are left out. */
export function captureRoute(view: string, members: readonly Pick<Feature, 'id'>[], rank: ReadonlyMap<string, number>): TroubleRoute {
  const ids = members.map((f) => f.id).filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  return { view, ids, has: new Set(ids), i: -1 };
}

/** The next cursor, or null when the step leaves the route (past the last going forward, before the first going back). */
export function stepRoute(r: TroubleRoute, dir: 1 | -1): number | null {
  if (!r.ids.length) return null;
  if (r.i < 0) return dir > 0 ? 0 : r.ids.length - 1;
  const j = r.i + dir;
  return j < 0 || j >= r.ids.length ? null : j;
}

/** Members in trouble now that the frozen route does not hold. */
export function newMembers(r: TroubleRoute, members: readonly Pick<Feature, 'id'>[]): number {
  let n = 0;
  for (const f of members) if (!r.has.has(f.id)) n++;
  return n;
}

/** One trouble said on arrival: the lens, its verdict, the reason (manifest text). */
export interface ArrivalTrouble { lens: string; lensName: string; h: 'bad' | 'watch'; why: string }
/** What an arrival says, as data. `room` is null when the feature has no tile. */
export interface RouteArrival {
  /** 1-based position, the route's length, and how many members joined since capture. */
  at: number; n: number; fresh: number;
  fid: string; name: string; room: string | null;
  /** General: every trouble now ([] = no trouble now). A lens: its trouble now, or its health now when it has none. */
  health:
    | { kind: 'general'; trouble: ArrivalTrouble[] }
    | { kind: 'lens'; lens: string; lensName: string; trouble: ArrivalTrouble | null; now: Health };
}

/** What an arrival says (bp: "3 of 8 · 1 new · Payments › Card vault · Security bad: 2 secrets found"), as data. */
export function routeWords(P: { LENS: Readonly<Record<string, Pick<LensDef, 'name'>>> }, L: Pick<Layout, 'TILE'>, f: Feature, view: string, i: number, n: number, fresh: number): RouteArrival {
  const T = L.TILE[f.id];
  const nameOf = (id: string) => P.LENS[id]?.name ?? id;
  const said = (t: Feature['trouble'][number]): ArrivalTrouble => ({ lens: t.lens, lensName: nameOf(t.lens), h: t.h, why: t.why });
  const base = { at: i + 1, n, fresh, fid: f.id, name: f.name, room: T ? T.room.d.name : null };
  if (view === 'general') return { ...base, health: { kind: 'general', trouble: f.trouble.map(said) } };
  const t = f.trouble.find((x) => x.lens === view);
  return { ...base, health: { kind: 'lens', lens: view, lensName: nameOf(view), trouble: t ? said(t) : null, now: f.lens[view]?.h ?? 'unmeasured' } };
}

/** The words routeSentence needs, from the text hook. bp: "<at> of <n>", "<n> new", "no trouble now", "<lens> now <health>". */
export interface RouteSentenceWords {
  position(at: number, n: number): string;
  fresh(n: number): string;
  noTrouble: string;
  verdict(h: Health): string;
  nowReads(lensName: string, h: Health): string;
}

/** bp's arrival sentence: position · new · room › feature · health (bp joins troubles with '; ', parts with ' · '). */
export function routeSentence(a: RouteArrival, w: RouteSentenceWords): string {
  const one = (t: ArrivalTrouble) => t.lensName + ' ' + w.verdict(t.h) + ': ' + t.why;
  const health = a.health.kind === 'general'
    ? (a.health.trouble.length ? a.health.trouble.map(one).join('; ') : w.noTrouble)
    : (a.health.trouble ? one(a.health.trouble) : w.nowReads(a.health.lensName, a.health.now));
  return w.position(a.at, a.n) + (a.fresh ? ' · ' + w.fresh(a.fresh) : '') + ' · ' + (a.room ? a.room + ' › ' : '') + a.name + ' · ' + health;
}
