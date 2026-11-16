// Follow bp's shared focus in the sheet (spark roadmap S6, G4 and G5). The window has ONE follower (lens/bpFollower.ts),
// shared with the Monitor's Blueprint and Morning tabs; the open sheet is one more visible surface (bp's follow chip
// lists "Personas" while it is open), and the place its own product receives lands here, the bp way, on Personas' plan
// (model/focusPlace.ts):
//   site / no target -> level 0;  wing -> the wing;  room -> the same Personas bay or room (model/focusPlace.ts says which
//   map shape draws a capability as which);  bp bay -> the same bay, else its capability's;  feature -> its L4 sheet, on
//   `lens=` from the hash when known;
//   an id this plan does not draw -> the camera holds still and the status line says "<kind> <id> is not on Personas' plan".
// A place on another Personas product reopens the sheet there (the follower's `open`, `place` on LensSheetRequest); a
// product bp names that Personas has not got says "Not in Personas: <slug>". Nothing is ever published (G7 is the
// owner's decision). bp down = "bp offline", said by Rust's 5 s hold, never an error each second.
import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { useBpFollowSurface, useFollowerState } from '../../lens/useBpFollow';
import type { BpFollower, FollowNote } from '../../lens/bpFollower';
import type { FocusPlace } from '../model/focus';
import { placeMove } from '../model/focusPlace';
import type { Plan } from '../model/plan';
import type { UiAction } from '../state/uiState';
import type { BlueprintText } from './useBlueprintText';
import type { Nav } from './useNavigation';

export interface FollowState {
  /** The sheet has a follower (a live product); the fixture has none and shows no chip. */
  available: boolean;
  on: boolean;
  /** Whether bp answered the last read; null before the first read. */
  online: boolean | null;
  /** Who the shared place came from (bp's reader label), once one arrived. */
  from: string | null;
  toggle(): void;
}

const OFF: FollowState = { available: false, on: false, online: null, from: null, toggle: () => {} };

/** A follower's note in the sheet's words. */
export function noteWords(n: FollowNote, { B, tx }: Pick<BlueprintText, 'B' | 'tx'>): string {
  return n.kind === 'product' ? tx(B.follow_not_here, { slug: n.slug }) : tx(B.follow_missing, { kind: n.what, id: n.id });
}

interface Deps {
  follower: BpFollower | undefined;
  projectId: string;
  plan: Plan;
  nav: Nav;
  dispatch: Dispatch<UiAction>;
  text: BlueprintText;
  /** The camera exists (a place can only be flown to once it does). */
  ready: boolean;
  /** The place the sheet was opened at (a shared place on this product, from another product's sheet or a tab). */
  initialPlace?: FocusPlace | undefined;
}

export function useFocusFollow({ follower, projectId, plan, nav, dispatch, text, ready, initialPlace }: Deps): FollowState {
  const latest = useRef({ plan, nav, dispatch, text });
  latest.current = { plan, nav, dispatch, text };
  useBpFollowSurface(follower, true);
  const st = useFollowerState(follower);

  /** Apply one place on this product's plan; what it could not do, or null when it landed. `ms` 0 lands at once. */
  const applyHere = useCallback((place: FocusPlace, ms?: number): FollowNote | null => {
    const { plan: P, nav: N, dispatch: D } = latest.current;
    const m = placeMove(place, P);
    if (m.kind === 'site') N.toLevel(0);
    else if (m.kind === 'wing' || m.kind === 'room' || m.kind === 'bay') N.flyToPlace(m.kind, m.id, ms);
    else if (m.kind === 'feature') N.openSheet(m.fid, m.lens);
    else return { kind: 'missing', what: m.what, id: m.id };
    if (place.say) D({ type: 'say', text: place.say });
    return null;
  }, []);

  // this product's places land here once the camera exists; another product's open the sheet there
  useEffect(() => {
    if (!follower || !ready) return;
    return follower.attach(projectId, applyHere);
  }, [follower, projectId, ready, applyHere]);

  // the place the sheet was opened at, once
  const opened = useRef(false);
  useEffect(() => {
    if (!ready || opened.current || !initialPlace) return;
    opened.current = true;
    // at once, as the first feature a sheet opens at: a camera still flying from home is snapped back by the first resize
    const note = applyHere(initialPlace, 0);
    if (note) dispatch({ type: 'say', text: noteWords(note, latest.current.text) });
  }, [ready, initialPlace, applyHere, dispatch]);

  // what the follower could not apply goes to the status line, once per note
  const note = st?.note ?? null;
  useEffect(() => {
    if (note) latest.current.dispatch({ type: 'say', text: noteWords(note, latest.current.text) });
  }, [note]);

  if (!follower || !st) return OFF;
  return { available: true, on: st.on, online: st.online, from: st.from, toggle: follower.toggle };
}
