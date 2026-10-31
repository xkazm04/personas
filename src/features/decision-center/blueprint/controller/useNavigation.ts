// Moving about the drawing: levels, the current item, the L4 sheet. Every move goes through the camera (the engine
// flies) and the sheet's reducer, so the plan, the queue and the depth rail can never disagree about where we are.
// The compare panel (WP4b) is a place too: J/K walk the built items in pack order while it is open, as bp's ledger.
import { useCallback, useMemo, type Dispatch } from 'react';
import type { Engine } from '../engine/Engine';
import type { Plan } from '../model/plan';
import type { Work, WorkItem } from '../model/work';
import { waitingIn } from '../model/scope';
import { awaitsTriage } from '../model/states';
import { isBuilt, packOrder } from '../model/triage';
import type { UiAction, UiState } from '../state/uiState';

export interface Nav {
  /** Fly to a level (0..3) over the current place, or open the feature sheet (4). */
  toLevel(n: number): void;
  openSheet(fid: string, lens?: string): void;
  closeSheet(): void;
  /** Open the compare panel on a built item (its sheet opens with it), or close it (null). */
  compare(p: WorkItem | null): void;
  /** Make an item current; `fly` sends the camera to it. */
  select(p: WorkItem | null, fly?: boolean): void;
  /** Walk the waiting work: +1 next, -1 previous. */
  step(d: 1 | -1): WorkItem | null;
  /** Fly to the next or previous wing. */
  wing(d: 1 | -1): void;
  zoom(f: number): void;
  /** Fly a camera target in (find results). */
  flyToFeature(fid: string): void;
  /** Fly to a wing, room or bay by id; `ms` 0 lands at once (a sheet opening at a place, before its first resize). */
  flyToPlace(kind: 'wing' | 'room' | 'bay', id: string, ms?: number): void;
}

interface Deps {
  engine: Engine | null;
  plan: Plan;
  work: Work;
  ui: UiState;
  dispatch: Dispatch<UiAction>;
  queue: readonly WorkItem[];
}

export function useNavigation({ engine, plan, work, ui, dispatch, queue }: Deps): Nav {
  const select = useCallback((p: WorkItem | null, fly = false) => {
    dispatch({ type: 'item', id: p ? p.id : null });
    engine?.setFocus(p ? { fid: p.fid, pid: p.id } : null);
    if (p && fly && engine) {
      const T = plan.L.TILE[p.fid];
      if (T) {
        const lv = engine.cam.level().n, target = Math.max(2, Math.min(3, lv));
        engine.cam.flyTo(engine.cam.fitOf([T.wing, T.room, T.bay][target - 1] as typeof T.bay));
      }
    }
  }, [engine, plan, dispatch]);

  const openSheet = useCallback((fid: string, lens?: string) => {
    if (!plan.L.TILE[fid]) return;
    const own = work.byFeature.get(fid) ?? [];
    // the sheet opens on an item of the feature when the current one is elsewhere: a feature's own waiting work first,
    // then a built item waiting for triage, then anything; a built one opens in the compare panel
    let compare: string | null | undefined;
    if (!ui.itemId || work.byId.get(ui.itemId)?.fid !== fid) {
      const first = own.find((p) => p.status === 'proposed') ?? own.find((p) => p.status === 'approved')
        ?? own.find((p) => isBuilt(p) && awaitsTriage(p.status)) ?? own[0] ?? null;
      select(first);
      compare = first && isBuilt(first) ? first.id : null;
    }
    dispatch({ type: 'openSheet', fid, lens, compare });
  }, [plan, work, ui.itemId, select, dispatch]);

  const compare = useCallback((p: WorkItem | null) => {
    if (!p) { dispatch({ type: 'compare', id: null }); return; }
    select(p);
    if (ui.sheet !== p.fid) dispatch({ type: 'openSheet', fid: p.fid, lens: ui.sheetLens, compare: p.id });
    else dispatch({ type: 'compare', id: p.id });
  }, [ui.sheet, ui.sheetLens, select, dispatch]);

  const closeSheet = useCallback(() => dispatch({ type: 'closeSheet' }), [dispatch]);

  const toLevel = useCallback((n: number) => {
    if (!engine) return;
    if (n >= 4) {
      const cur = ui.itemId ? work.byId.get(ui.itemId) : undefined;
      let fid = cur?.fid ?? ui.sheet;
      if (!fid) {
        const cx = engine.cam.wx(engine.cam.FW / 2), cy = engine.cam.wy(engine.cam.FH / 2);
        let best = Infinity;
        for (const T of plan.L.tiles) { const d = Math.hypot(T.x + T.w / 2 - cx, T.y + T.h / 2 - cy); if (d < best) { best = d; fid = T.id; } }
      }
      if (fid) openSheet(fid);
      return;
    }
    if (ui.sheet) dispatch({ type: 'closeSheet' });
    const cur = ui.itemId ? work.byId.get(ui.itemId) : undefined;
    const ch = cur ? engine.cam.chainOf(cur.fid) : null;
    if (ch && n > 0) { const o = ch[n - 1]; if (o) { engine.cam.flyTo(engine.cam.fitOf(o)); return; } }
    engine.cam.goLevel(n, engine.cam.level().chain);
  }, [engine, plan, work, ui.itemId, ui.sheet, openSheet, dispatch]);

  const step = useCallback((d: 1 | -1): WorkItem | null => {
    if (ui.compare) {
      const order = packOrder(work, ui.sheetLens);
      const i = order.findIndex((p) => p.id === ui.compare);
      const to = order[i < 0 ? 0 : (i + d + order.length) % order.length] ?? null;
      if (to) compare(to);
      return to;
    }
    let list = queue.filter((p) => p.status === 'proposed');
    if (!list.length) list = waitingIn(work, plan.L, ui.lens);
    if (!list.length) return null;
    const i = ui.itemId ? list.findIndex((p) => p.id === ui.itemId) : -1;
    const next = list[(i + d + list.length) % list.length] ?? null;
    if (next) {
      select(next, !ui.sheet);
      if (ui.sheet) dispatch({ type: 'openSheet', fid: next.fid, lens: ui.sheetLens });
    }
    return next;
  }, [queue, work, plan, ui.lens, ui.itemId, ui.sheet, ui.sheetLens, ui.compare, select, compare, dispatch]);

  const wing = useCallback((d: 1 | -1) => {
    if (!engine) return;
    const Ws = plan.L.wings, cur = engine.cam.level().chain[0], i = cur ? Ws.indexOf(cur) : -1;
    const nx = Ws[(i + d + Ws.length) % Ws.length];
    if (!nx) return;
    dispatch({ type: 'closeSheet' });
    engine.cam.flyTo(engine.cam.fitOf(nx));
  }, [engine, plan, dispatch]);

  const zoom = useCallback((f: number) => { if (engine) engine.cam.zoomAt(engine.cam.FW / 2, engine.cam.FH / 2, f); }, [engine]);

  const flyToFeature = useCallback((fid: string) => {
    const T = plan.L.TILE[fid];
    if (!engine || !T) return;
    dispatch({ type: 'closeSheet' });
    engine.cam.flyTo(engine.cam.fitOf(T.bay));
    engine.setFocus({ fid, pid: null });
  }, [engine, plan, dispatch]);

  const flyToPlace = useCallback((kind: 'wing' | 'room' | 'bay', id: string, ms?: number) => {
    if (!engine) return;
    const o = kind === 'wing' ? plan.L.WING[id] : kind === 'room' ? plan.L.ROOM[id] : plan.L.BAY[id];
    if (!o) return;
    dispatch({ type: 'closeSheet' });
    if (ms === undefined) engine.cam.flyTo(engine.cam.fitOf(o));
    else engine.cam.flyTo(engine.cam.fitOf(o), ms);
  }, [engine, plan, dispatch]);

  return useMemo(() => ({ toLevel, openSheet, closeSheet, compare, select, step, wing, zoom, flyToFeature, flyToPlace }), [toLevel, openSheet, closeSheet, compare, select, step, wing, zoom, flyToFeature, flyToPlace]);
}
