// The words the spoken plan composes its sentences from (spark bp-sync WP2): a trouble-walk arrival (engine/trouble-route
// routeSentence) and the place the camera rests on (engine/place-words placeSentence). Every word is t.decisionCenter
// .blueprint (the `sync_*` keys, the engine's own count words); the pure modules only join them.
import type { EngineWords } from '../engine/types';
import type { PlaceSentenceWords } from '../engine/place-words';
import type { RouteSentenceWords } from '../engine/trouble-route';
import type { BlueprintText } from './useBlueprintText';

export interface SyncWords { route: RouteSentenceWords; place: PlaceSentenceWords }

export function syncWords({ B, tx }: BlueprintText, W: EngineWords): SyncWords {
  const verdict = (h: Parameters<EngineWords['verdict']>[0]) => W.verdict(h).toLowerCase();
  return {
    route: {
      position: (at, n) => tx(B.sync_route_position, { at, n }),
      fresh: (n) => tx(B.sync_route_new, { count: n }),
      noTrouble: B.sync_route_no_trouble,
      verdict,
      nowReads: (lens, h) => tx(B.sync_route_now_reads, { lens, health: verdict(h) }),
    },
    place: {
      featuresN: W.featuresN, live: W.live, building: W.building, onPaper: W.onPaper,
      verdict: W.verdict, bad: W.bad, toWatch: W.toWatch,
      placeName: (w) => {
        if (w.type === 'bay') return tx(B.sync_place_bay, { name: w.title, room: w.room ?? '' });
        if (w.type === 'room') return tx(B.sync_place_room, { name: w.title, letter: w.wing?.letter ?? '' });
        if (w.type === 'wing') return tx(B.sync_place_wing, { name: w.title, letter: w.wing?.letter ?? '' });
        return tx(B.sync_place_bld, { name: w.title });
      },
      inTroubleUnder: (n, lens) => (lens ? tx(B.sync_in_trouble_under, { count: n, lens }) : tx(B.count_in_trouble, { count: n })),
    },
  };
}
