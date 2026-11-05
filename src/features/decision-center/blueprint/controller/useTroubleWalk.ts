// PORTED from bp apps/web/src/engine/Engine.ts @ 93f30b0 (spark bp-sync, WP2): stepTrouble and the route's Enter target.
// EDIT (port): the route state lives in this hook, not the engine; the camera moves through the sheet's navigation
// (nav.flyToFeature: the bay, the focus ring) and the arrival is said through the spoken plan once the camera rests.
// bp opens the arrival on Enter only when its tile is large on screen; here Enter opens the current stop whenever a walk
// is active (useSheetKeys). Opening ANOTHER feature's sheet ends the walk, so a walk's Enter never shadows the D14
// answer of a feature the reader chose themselves. bp's English refusal is t.* (sync_walk_none / _lens).
// N / Shift+N walk the features the current lens marks bad or watch (General: every lens's), in the plan's walk order.
// The route is captured on the first N and FROZEN while it is read; a feature that turns bad mid-walk is announced as
// "N new" and joins when the route is captured again (stepping past either end, or under another lens).
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { TroubleIndex } from '../engine/trouble';
import { captureRoute, newMembers, routeRank, routeSentence, routeWords, stepRoute, type TroubleRoute } from '../engine/trouble-route';
import type { Plan } from '../model/plan';
import type { UiAction, UiState } from '../state/uiState';
import type { SpokenPlan } from './spokenPlan';
import type { SyncWords } from './syncWords';
import type { BlueprintText } from './useBlueprintText';
import type { Nav } from './useNavigation';

/** Where the walk stands: the view it was captured under, the 1-based stop of n, and the stop's feature. */
export interface WalkState { view: string; at: number; n: number; fid: string }

export interface TroubleWalk {
  walk: WalkState | null;
  /** N (+1) / Shift+N (-1); ignored while a feature sheet is open (bp: the plan behind the page does not move). */
  stepWalk(dir: 1 | -1): void;
  endWalk(): void;
}

interface Deps { plan: Plan; ui: UiState; trouble: TroubleIndex; nav: Nav; spoken: SpokenPlan; words: SyncWords; text: BlueprintText; dispatch: Dispatch<UiAction> }

const membersOf = (ix: TroubleIndex, view: string) => (view === 'general' ? ix.all() : ix.of(view));

export function useTroubleWalk(d: Deps): TroubleWalk {
  const { plan, ui, nav, spoken, dispatch } = d;
  const live = useRef(d);
  live.current = d;
  const route = useRef<TroubleRoute | null>(null);
  const rank = useMemo(() => routeRank(plan.L), [plan]);
  const [walk, setWalk] = useState<WalkState | null>(null);

  const endWalk = useCallback(() => { route.current = null; setWalk(null); }, []);

  const stepWalk = useCallback((dir: 1 | -1) => {
    if (ui.sheet) return;
    const view = ui.lens, members = membersOf(live.current.trouble, view);
    let r = route.current, j = r && r.view === view ? stepRoute(r, dir) : null;
    if (!r || j === null) { r = route.current = captureRoute(view, members, rank); j = stepRoute(r, dir); }
    if (j === null) {
      route.current = null; setWalk(null);
      const { B, tx } = live.current.text, lens = view === 'general' ? null : plan.LENS[view]?.name ?? view;
      dispatch({ type: 'say', text: lens ? tx(B.sync_walk_none_lens, { lens }) : B.sync_walk_none });
      return;
    }
    r.i = j;
    const fid = r.ids[j]!, n = r.ids.length, at = j, held = r;
    nav.flyToFeature(fid);
    setWalk({ view, at: at + 1, n, fid });
    spoken.saySoon(() => {
      const L = live.current, f = L.plan.S.features.find((x) => x.id === fid);
      if (!f) return '';
      return routeSentence(routeWords(L.plan, L.plan.L, f, view, at, n, newMembers(held, membersOf(L.trouble, view))), L.words.route);
    });
  }, [ui.sheet, ui.lens, rank, plan, nav, spoken, dispatch]);

  // the reader opened another feature: the walk is over (Esc from the stop's own sheet keeps it)
  useEffect(() => { if (walk && ui.sheet && ui.sheet !== walk.fid) endWalk(); }, [walk, ui.sheet, endWalk]);

  return useMemo(() => ({ walk, stepWalk, endWalk }), [walk, stepWalk, endWalk]);
}
