// The models spark bp-sync WP2 wires into the sheet: the trouble index, replayed health on a travelled date, the
// comparison of two dates and readiness for a scope. This hook OWNS them (the engine only draws what it is handed), so
// the canvas, the panels and the keys read one instance of each:
//   - trouble: rebuilt on the health version (useSheetData's healthV), never from a load-time snapshot;
//   - replay: re-synced when the travelled date or the scan moves; `replayed` = any pair replayed on that date;
//   - comparison: compareDates computed once per (A, B, scan); B is the travelled date, or the data's now;
//   - readiness: the scope is resolved as G opens it (model/readyScope), the verdict recomputed when health or the scan moves.
import { useCallback, useEffect, useMemo, type Dispatch } from 'react';
import type { Engine } from '../engine/Engine';
import { ReplayIndex } from '../engine/replay';
import { TroubleIndex } from '../engine/trouble';
import { compareDates, type Comparison } from '../model/compare';
import type { Plan } from '../model/plan';
import { readiness, type Readiness } from '../model/ready';
import { readyScopeOf, type ReadyScope } from '../model/readyScope';
import type { Work } from '../model/work';
import type { BlueprintData } from '../source';
import type { UiAction, UiState } from '../state/uiState';
import type { ViewStore } from '../state/viewStore';
import { fmtDay } from '../ui/timeline/dates';
import type { BlueprintText } from './useBlueprintText';
import type { Nav } from './useNavigation';

/** Days a good reading stays proof (older: unproven), bp Engine.readyMaxAge. */
export const READY_MAX_AGE_DAYS = 30;

export interface SyncModels {
  trouble: TroubleIndex;
  /** The health version the trouble index is built at (React re-reads counts on it). */
  troubleV: number;
  replay: ReplayIndex;
  /** The replay index's version (it is rebuilt in place on a new date or scan): a key for anything drawn from it. */
  replayV: number;
  /** Any (feature, lens) pair replayed on the travelled date (false at now). */
  replayed: boolean;
  /** The comparison's endpoint B: the travelled date, or the data's now. */
  day: string;
  comparison: Comparison | null;
  /** Pin A at the travelled date (at now: says why and pins nothing). */
  pinA(): void;
  unpinA(): void;
  /** P: unpin when pinned, else pin. */
  togglePin(): void;
  readiness: { scope: ReadyScope; result: Readiness } | null;
  /** G: open readiness on the scope in view, or close it. */
  toggleReady(): void;
}

interface Deps {
  plan: Plan; data: BlueprintData; work: Work; healthV: number; ui: UiState; dispatch: Dispatch<UiAction>;
  engine: Engine | null; view: ViewStore; nav: Nav; text: BlueprintText;
}

/** Today as the map writes days: in UTC (the map's own zone, ui/timeline/dates.ts), YYYY-MM-DD. */
const UTC_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = (): string => UTC_DAY.format(new Date());

export function useSyncModels({ plan, data, work, healthV, ui, dispatch, engine, view, nav, text }: Deps): SyncModels {
  const asOf = plan.S.asOf, day = ui.asOf ?? asOf, scan = data.scan;
  const trouble = useMemo(() => new TroubleIndex(plan.S.features, { healthV }), [plan, healthV]);
  const replay = useMemo(() => new ReplayIndex(plan.S.features, plan.lenses), [plan]);
  // a rebuild on a discrete change (the date, the scan), never per render: sync answers false for what it holds
  const replayV = useMemo(() => { replay.sync(day, asOf, scan); return replay.version; }, [replay, day, asOf, scan]);
  const comparison = useMemo(
    () => (ui.cmpA && ui.cmpA !== day ? compareDates(plan.S.features, plan.lenses, scan, ui.cmpA, day, asOf) : null),
    [ui.cmpA, day, scan, plan, asOf],
  );
  const F = useMemo(() => Object.fromEntries(plan.S.features.map((f) => [f.id, f])), [plan]);
  const scope = ui.ready;
  const ready = useMemo(() => {
    if (!scope) return null;
    const t = today(), now = t > asOf ? t : asOf;
    return { scope, result: readiness({ lenses: plan.lenses, F }, scan, scope.ids, { maxAgeDays: READY_MAX_AGE_DAYS, now }, scan.proposals) };
  // a read that re-judges health brings a new plan (and F), so the verdict follows it
  }, [scope, plan, F, scan, asOf]);

  useEffect(() => { engine?.setTrouble(trouble); }, [engine, trouble]);
  useEffect(() => { engine?.setReplay(replay); }, [engine, replay, replayV]);
  useEffect(() => { engine?.setCompare(comparison); }, [engine, comparison]);
  useEffect(() => { engine?.setScope(scope ? new Set(scope.ids) : null); }, [engine, scope]);

  const { B, tx, language } = text;
  const pinA = useCallback(() => {
    if (!ui.asOf || ui.asOf >= asOf) { dispatch({ type: 'say', text: B.sync_pin_now }); return; }
    dispatch({ type: 'cmpA', date: ui.asOf });
    dispatch({ type: 'say', text: tx(B.sync_pinned, { date: fmtDay(language, ui.asOf) }) });
  }, [ui.asOf, asOf, dispatch, B, tx, language]);
  const unpinA = useCallback(() => {
    if (!ui.cmpA) return;
    dispatch({ type: 'cmpA', date: null });
    dispatch({ type: 'say', text: B.sync_unpinned });
  }, [ui.cmpA, dispatch, B]);
  const togglePin = useCallback(() => { if (ui.cmpA) unpinA(); else pinA(); }, [ui.cmpA, pinA, unpinA]);

  const toggleReady = useCallback(() => {
    if (ui.ready) { dispatch({ type: 'ready', scope: null }); return; }
    const lv = view.getLevel();
    const picked = ui.selected.map((id) => work.byId.get(id)?.fid).filter((f): f is string => !!f);
    const sc = readyScopeOf(plan.L, { picked, sheet: ui.sheet, chain: { wing: lv.wing, room: lv.room, bay: lv.bay } });
    if (!sc) return;
    dispatch({ type: 'ready', scope: sc });
    // bp setMode: the page closes so the plan shows the outline; one feature is flown to (the place in view already is)
    if (sc.kind === 'feature') nav.flyToFeature(sc.id);
    else if (ui.sheet) nav.closeSheet();
  }, [ui.ready, ui.selected, ui.sheet, view, work, plan, dispatch, nav]);

  const replayed = replay.pairs > 0;
  return useMemo(
    () => ({ trouble, troubleV: healthV, replay, replayV, replayed, day, comparison, pinA, unpinA, togglePin, readiness: ready, toggleReady }),
    [trouble, healthV, replay, replayV, replayed, day, comparison, pinA, unpinA, togglePin, ready, toggleReady],
  );
}
