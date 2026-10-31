// Where a shared bp place lands on Personas' plan (spark roadmap S6; bp docs/concepts/one-morning-brief/personas.md
// section 3.2 and one-morning/personas-adoption.md section 2.3). Personas' layout is bp's fbef867 port, which draws a
// map in one of two shapes, and bp's ids are looked up in that order:
//   - a v3 map (bp's demo products, measured live 2026-10-31): Personas draws one wing and one room per capability
//     (`0:<cap>`, `<cap>`) and bp's own bays (`<cap>.<kind>`) as its bays. A bp room (a capability since bp 57ee810) is
//     then a Personas ROOM, and a bp bay is the same Personas bay;
//   - the older fixture map (Kettle): a Personas bay is a capability, so a bp room is a Personas BAY, and a bp bay
//     `<cap>.<kind>` lands on its capability's bay.
// A bp wing is `<building>:<domain group>` (`0:FND`); Personas' layout has no node for a domain group unless its own
// wing ids match. An id that resolves to nothing never guesses: the camera holds still and the sheet says so. Pure: the
// sheet controller (useFocusFollow) turns a move into the navigation call.
import type { FocusPlace } from './focus';
import type { Plan } from './plan';

export type PlaceMove =
  | { kind: 'site' }
  | { kind: 'wing'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'bay'; id: string }
  | { kind: 'feature'; fid: string; lens?: string }
  /** The place names something this plan does not draw: hold still and say it. */
  | { kind: 'missing'; what: string; id: string };

/** `lens=<id>` from a bp web hash ('#at=bkg-06&lens=perf'), when the plan knows that lens. */
function lensOf(hash: string | undefined, plan: Plan): string | undefined {
  const m = hash ? /[#&]lens=([^&]*)/.exec(hash) : null;
  const id = m ? decodeURIComponent(m[1]!) : undefined;
  return id && (id === 'general' || plan.LENS[id]) ? id : undefined;
}

/** The move a place asks of the open product's plan. The caller has already matched `place.product` to it. */
export function placeMove(place: FocusPlace, plan: Plan): PlaceMove {
  const t = place.target, L = plan.L;
  if (!t || t.kind === 'site') return { kind: 'site' };
  const missing: PlaceMove = { kind: 'missing', what: t.kind, id: t.id };
  if (t.kind === 'feature') {
    if (!L.TILE[t.id]) return missing;
    const lens = lensOf(place.hash, plan);
    return { kind: 'feature', fid: t.id, ...(lens ? { lens } : {}) };
  }
  if (t.kind === 'wing') {
    if (L.WING[t.id]) return { kind: 'wing', id: t.id };
    // a bare domain id (an older publisher) is the room that covers the same ground as its wing
    const room = L.ROOM[t.id];
    return room ? { kind: 'wing', id: room.wing.id } : missing;
  }
  // a room (or a bay, which bp publishes as a room place): the same Personas bay (a v3 map's bay, or the fixture's
  // capability), else the same Personas room (a v3 map's capability), else a bp bay `<cap>.<kind>` on its capability's bay
  if (L.BAY[t.id]) return { kind: 'bay', id: t.id };
  if (L.ROOM[t.id]) return { kind: 'room', id: t.id };
  const cap = /^(.+)\.[a-z0-9-]+$/.exec(t.id)?.[1];
  if (cap && L.BAY[cap]) return { kind: 'bay', id: cap };
  if (cap && L.ROOM[cap]) return { kind: 'room', id: cap };
  return missing;
}
