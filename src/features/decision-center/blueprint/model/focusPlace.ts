// Where a shared bp place lands on Personas' plan (spark roadmap S6; bp docs/concepts/one-morning-brief/personas.md
// section 3.2 and one-morning/personas-adoption.md section 2.3). Personas' layout is bp's fbef867 port, and bp has moved
// since: a bp room is a capability since bp 57ee810, which is a Personas BAY; a bp wing is `<building>:<domainId>`, and
// Personas has one building, `0:`. An id that resolves to nothing never guesses: the camera holds still and the sheet
// says so. Pure: the sheet controller (useFocusFollow) turns a move into the navigation call.
import type { FocusPlace } from './focus';
import type { Plan } from './plan';

export type PlaceMove =
  | { kind: 'site' }
  | { kind: 'wing'; id: string }
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
  // a room: bp's room is a capability (a Personas bay); a bp bay id `<capability>.<kind>` lands on its capability
  if (L.BAY[t.id]) return { kind: 'bay', id: t.id };
  const cap = /^(.+)\.[a-z]+$/.exec(t.id)?.[1];
  if (cap && L.BAY[cap]) return { kind: 'bay', id: cap };
  // bp before 57ee810 named a domain as a room: its Personas room spans its wing
  const room = L.ROOM[t.id];
  return room ? { kind: 'wing', id: room.wing.id } : missing;
}
