// The spoken plan, wired (spark bp-sync WP2): when the place in view changes (the level snapshot), the lens or the
// travelled date, the place sentence (engine/place-words) is said through the sheet's ONE live region (`ui.say`, printed
// by ui/header/ProjLine.tsx) once the camera has rested. The trouble walk hands it its arrival words instead.
import { useEffect, useRef, type Dispatch } from 'react';
import type { Engine } from '../engine/Engine';
import { placeSentence, placeWords, type PlaceType } from '../engine/place-words';
import type { Plan } from '../model/plan';
import type { UiAction, UiState } from '../state/uiState';
import type { LevelSnap, ViewStore } from '../state/viewStore';
import { SpokenPlan } from './spokenPlan';
import type { SyncWords } from './syncWords';

interface Deps { engine: Engine | null; view: ViewStore; plan: Plan; ui: UiState; dispatch: Dispatch<UiAction>; words: SyncWords }

/** The deepest place a level snapshot is over: its bay, room or wing, else the building. */
export function placeIn(plan: Plan, lv: LevelSnap): { type: PlaceType; id: string } {
  if (lv.bay) return { type: 'bay', id: lv.bay };
  if (lv.room) return { type: 'room', id: lv.room };
  if (lv.wing) return { type: 'wing', id: lv.wing };
  return { type: 'bld', id: plan.L.bld.id };
}

export function useSpokenPlan(d: Deps): SpokenPlan {
  const live = useRef(d);
  live.current = d;
  const sp = useRef<SpokenPlan | null>(null);
  if (!sp.current) {
    sp.current = new SpokenPlan({
      still: () => { const e = live.current.engine; return !e ? Infinity : e.flying ? -1 : performance.now() - e.restFrom; },
      place: () => {
        const { plan, ui, view, words } = live.current;
        if (ui.sheet || ui.page === 'ledger') return null;
        const p = placeIn(plan, view.getLevel());
        const w = placeWords(plan.L, plan, p.type, p.id, ui.lens, ui.asOf ?? plan.S.asOf, plan.S.asOf, ui.viewDays);
        return w ? placeSentence(w, words.place) : null;
      },
      say: (text) => live.current.dispatch({ type: 'say', text }),
    });
  }
  const spoken = sp.current;
  useEffect(() => () => spoken.cancel(), [spoken]);

  // a new place speaks once it rests (not the one the sheet opened at)
  const { view } = d;
  useEffect(() => {
    let prev = view.getLevel();
    return view.subscribe(() => {
      const lv = view.getLevel();
      if (lv.n === prev.n && lv.wing === prev.wing && lv.room === prev.room && lv.bay === prev.bay) return;
      prev = lv;
      spoken.saySoon();
    });
  }, [view, spoken]);
  // the same place, said through another lens or on another date
  const first = useRef(true);
  const { lens, asOf } = d.ui;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    spoken.saySoon();
  }, [lens, asOf, spoken]);
  return spoken;
}
