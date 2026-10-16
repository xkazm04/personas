// What the pointer does on the plan: hover cards (a fixture, a flag, or the room under the pointer), a click selects,
// Shift+click picks the fixture's items for one batch decision (bp's Shift-click target; the selection bar acts on
// them), a double click descends, a trouble flag opens its lens on the feature (or, for a cluster, flies to the
// features it stands for).
import { useMemo, type Dispatch } from 'react';
import type { Engine } from '../engine/Engine';
import type { Hooks } from '../engine/types';
import type { Plan } from '../model/plan';
import type { Work, WorkItem } from '../model/work';
import { STATUS } from '../model/states';
import type { TipStore } from '../state/tipStore';
import type { UiAction } from '../state/uiState';
import type { Nav } from './useNavigation';

interface Deps { engine: Engine | null; plan: Plan; work: Work; lens: string; nav: Nav; dispatch: Dispatch<UiAction>; tip: TipStore }

/** The items a Shift+click picks on a fixture: those a batch move can act on (waiting decisions and built items), in the lens. */
export function pickable(work: Work, fid: string, lens: string): WorkItem[] {
  return (work.byFeature.get(fid) ?? []).filter((p) => (lens === 'general' || p.lens === lens) && (p.status === 'proposed' || (STATUS[p.status].built && !STATUS[p.status].terminal)));
}

export function useEngineHooks({ engine, plan, work, lens, nav, dispatch, tip }: Deps): Omit<Hooks, 'safe' | 'moved'> {
  return useMemo(() => ({
    hover(flag, tile, px, py, room) {
      const fid = flag ? flag.fid : tile ? tile.id : null;
      tip.set(fid ? { fid, flag, px, py, room: null } : room ? { fid: null, flag: null, px, py, room: room.id } : null);
    },
    flag(F) {
      if (!engine) return;
      if (F.fids.length > 1) {
        const xs = F.fids.map((id) => plan.L.TILE[id]).filter((T): T is NonNullable<typeof T> => !!T);
        if (!xs.length) return;
        const b = xs.reduce((a, T) => ({ x0: Math.min(a.x0, T.x), y0: Math.min(a.y0, T.y), x1: Math.max(a.x1, T.x + T.w), y1: Math.max(a.y1, T.y + T.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
        engine.cam.flyTo(engine.cam.fitCam({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, { t: 60, r: 60, b: 70, l: 60 }, 1));
        return;
      }
      nav.openSheet(F.fid, F.lens);
    },
    click(T, _room, shift) {
      if (!engine || !T) return;
      if (shift) {
        const items = pickable(work, T.id, lens), on = new Set(engine.picked), all = items.length > 0 && items.every((p) => on.has(p.id));
        for (const p of items) if (all || !on.has(p.id)) dispatch({ type: 'select', id: p.id });
        return;
      }
      const waiting = (work.byFeature.get(T.id) ?? []).filter((p) => p.status === 'proposed' && (lens === 'general' || p.lens === lens));
      if (waiting[0]) nav.select(waiting[0]); else { nav.select(null); engine.setFocus({ fid: T.id, pid: null }); }
      if (engine.cam.lod() > 0.5 && T.w * engine.cam.k >= 96 && engine.cam.level().n >= 3) nav.openSheet(T.id);
    },
    descend(T) {
      if (!engine) return;
      const lv = engine.cam.level().n;
      if (T && (lv >= 3 || (engine.cam.lod() > 0.5 && T.w * engine.cam.k >= 150))) { nav.openSheet(T.id); return; }
      const ch = T ? engine.cam.chainOf(T.id) : engine.cam.level().chain;
      const o = ch?.[Math.min(lv, 2)];
      if (o) engine.cam.flyTo(engine.cam.fitOf(o));
    },
  }), [engine, plan, work, lens, nav, dispatch, tip]);
}
