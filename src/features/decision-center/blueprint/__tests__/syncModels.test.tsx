/**
 * spark bp-sync WP2, the models wired into the sheet (controller/useSyncModels, useTroubleWalk, spokenPlan):
 *  - a feature that turns bad on a re-read is in the trouble index (flags, "Trouble by lens") without reopening;
 *  - on a past date the trouble marks draw the replayed health, a non-replayable pair draws nothing, now is unchanged;
 *  - P pins A only off now (at now it says why), the comparison is computed once per (A, B, scan), unpin clears it;
 *  - G reads the selection, else the open feature, else the room (else the wing) in view, else the whole product;
 *  - N walks the trouble: arrivals are said once the camera rests, members that turned bad mid-walk are "N new",
 *    an empty lens says "no trouble" and starts nothing, opening another feature ends the walk;
 *  - the spoken plan waits for the camera to rest and never says the same place twice in a row.
 */
import { act, renderHook } from '@testing-library/react';
import { useReducer, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpokenPlan, REST_MS } from '../controller/spokenPlan';
import { syncWords } from '../controller/syncWords';
import { useBlueprintText, useEngineWords } from '../controller/useBlueprintText';
import type { Nav } from '../controller/useNavigation';
import { useSheetData } from '../controller/useSheetData';
import { useSyncModels } from '../controller/useSyncModels';
import { useTroubleWalk } from '../controller/useTroubleWalk';
import type { Engine } from '../engine/Engine';
import { ReplayIndex } from '../engine/replay';
import { markHealth } from '../engine/syncMarks';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { readyScopeOf } from '../model/readyScope';
import { baseId } from '../model/timeview';
import { conditionFields } from '../standard/health';
import { NUMERIC } from '../standard/present';
import type { LensManifest } from '../standard/types';
import type { BlueprintActions, BlueprintData } from '../source';
import { initialUi, uiReducer, type UiState } from '../state/uiState';
import { ViewStore } from '../state/viewStore';

afterEach(() => { vi.useRealTimers(); });

const navStub = (): Nav & Record<string, ReturnType<typeof vi.fn>> => {
  const keys = ['toLevel', 'openSheet', 'closeSheet', 'compare', 'select', 'step', 'wing', 'zoom', 'flyToFeature', 'flyToPlace'];
  return Object.fromEntries(keys.map((k) => [k, vi.fn()])) as unknown as Nav & Record<string, ReturnType<typeof vi.fn>>;
};

/** A clean feature turned bad by an owner override (the map's own way to say "bad"), on a copy of the data. */
function turnBad(d: BlueprintData, slug: string, lens: string): BlueprintData {
  const next = structuredClone(d), s = next.structure as { facets: Record<string, Record<string, Record<string, unknown>>> };
  ((s.facets[slug] ??= {})[lens] ??= {}).override = { health: 'bad', by: 'test', why: 'turned bad in the test', until: '2099-12-31' };
  return next;
}

/** Everything the sync models read, wired the way useSheetController wires it, over a scripted refresh. */
function useHarness(initial: BlueprintData, actions: BlueprintActions, init: Partial<UiState> = {}, nav = navStub()) {
  const text = useBlueprintText(), words = useEngineWords(text);
  const [ui, dispatch] = useReducer(uiReducer, undefined, () => ({ ...initialUi(), ...init }));
  const sd = useSheetData(initial, actions);
  const view = useRef(new ViewStore()).current;
  const said = useRef<string[]>([]);
  const spoken = useRef(new SpokenPlan({ still: () => Infinity, place: () => null, say: (t) => said.current.push(t) })).current;
  const m = useSyncModels({ plan: sd.plan, data: sd.data, work: sd.work, healthV: sd.healthV, ui, dispatch, engine: null, view, nav, text });
  const walk = useTroubleWalk({ plan: sd.plan, ui, trouble: m.trouble, nav, spoken, words: syncWords(text, words), text, dispatch });
  return { ...sd, ui, dispatch, m, walk, view, nav, said: said.current };
}
const actionsOf = (refresh: () => Promise<BlueprintData>) => ({ refresh: vi.fn(refresh) }) as unknown as BlueprintActions;

const base = kettleData(), plan = buildPlan(base.structure, base.events), asOf = plan.S.asOf, weeks = plan.S.weeks;
const clean = plan.S.features.find((f) => !f.trouble.length && plan.L.TILE[f.id])!;
const lens0 = plan.lenses[0]!.id;

describe('the trouble index follows a re-read (TroubleIndex refresh flagging)', () => {
  it('a feature that turns bad after load is flagged and counted, without reopening the sheet', async () => {
    const bad = turnBad(base, clean.id, lens0);
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => bad)));
    const v0 = result.current.healthV, n0 = result.current.m.trouble.all().length, c0 = result.current.m.trouble.counts()[lens0]?.bad ?? 0;
    expect(result.current.m.trouble.all().some((f) => f.id === clean.id)).toBe(false);
    await act(async () => { await result.current.reload(); });
    expect(result.current.healthV).toBe(v0 + 1);
    expect(result.current.m.troubleV).toBe(v0 + 1);
    expect(result.current.m.trouble.all().some((f) => f.id === clean.id)).toBe(true);
    expect(result.current.m.trouble.all()).toHaveLength(n0 + 1);
    expect(result.current.m.trouble.counts()[lens0]!.bad).toBe(c0 + 1);
  });

  it('a read that changes no health leaves the version where it was', async () => {
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => { const d = kettleData(); d.scan.runs[0]!.status = 'aborted'; return d; })));
    const v0 = result.current.healthV, ix = result.current.m.trouble;
    await act(async () => { await result.current.reload(); });
    expect(result.current.healthV).toBe(v0);
    expect(result.current.m.trouble).toBe(ix);
  });
});

describe('replayed health on a past date (ReplayIndex)', () => {
  // the fixture reads only after its as-of date: one feature gets a reading of every numeric field a lens's rules read,
  // dated a month before, so today's rules can replay that pair on a past date (a high value, so it replays bad)
  const T = '2026-09-15';
  const past = (() => {
    const d = kettleData(), tpl = d.scan.measurements.find((m) => !m.phase)!;
    // every fixture lens has a rule over an enum, a boolean or a project field (never replayable); the project's cost
    // lens keeps only its rules over its own money fields, so a reading of each replays the pair by today's rules
    const st = d.structure as { lenses: { id: string; manifest: LensManifest }[] };
    const cost = st.lenses.find((l) => l.id === 'com.kettle.cost')!.manifest;
    const own = new Map((cost.fields ?? []).map((x) => [x.key, x] as const));
    cost.health!.rules = cost.health!.rules!.filter((r) => conditionFields(r.when).every((k) => { const x = own.get(k); return !!x && !x.source && NUMERIC.has(x.type); }));
    delete cost.health!.applies_when;
    const f = plan.L.tiles[0]!.f;
    let id = 9e6;
    for (const x of cost.fields ?? []) if (!x.source && NUMERIC.has(x.type)) d.scan.measurements.push({ ...tpl, id: id++, feature: baseId(f.id), lens: 'com.kettle.cost', metric: x.key, value: 99999, measured_at: '2026-09-01T00:00:00Z' });
    return d;
  })();

  it('at now nothing is replayed; on a past date pairs are replayed and `replayed` says so', () => {
    const { result } = renderHook(() => useHarness(past, actionsOf(async () => past)));
    expect(result.current.m.replayed).toBe(false);
    const v0 = result.current.m.replay.version;
    act(() => { result.current.dispatch({ type: 'asOf', date: T }); });
    expect(result.current.m.replayed).toBe(true);
    expect(result.current.m.replay.version).toBeGreaterThan(v0);
    act(() => { result.current.dispatch({ type: 'asOf', date: null }); });
    expect(result.current.m.replayed).toBe(false);
  });

  it('the marks draw the replayed health off now, nothing for a pair that cannot be replayed, the live health at now', () => {
    const p = buildPlan(past.structure, past.events), rp = new ReplayIndex(p.S.features, p.lenses);
    rp.sync(T, p.S.asOf, past.scan);
    const replayed = p.S.features.find((f) => rp.row(f.id)), none = p.S.features.find((f) => !rp.row(f.id))!;
    expect(replayed).toBeTruthy();
    const eng = (isNow: boolean, top: string | null = null) => ({ isNow, mixS: { top }, replay: rp }) as unknown as Engine;
    expect(markHealth(eng(false), replayed!)).toBe(rp.row(replayed!.id)!.health);
    expect(markHealth(eng(false), none)).toBeNull();
    expect(markHealth(eng(true), none)).toBe(none.health);
    const someLens = [...rp.row(replayed!.id)!.lens.keys()][0]!;
    expect(markHealth(eng(false, someLens), replayed!)).toBe(rp.row(replayed!.id)!.lens.get(someLens));
  });
});

describe('compare two dates (P pins A)', () => {
  const A = weeks[weeks.length - 6]!, Bd = weeks[weeks.length - 2]!;

  it('at now P pins nothing and says why', () => {
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData())));
    act(() => { result.current.m.togglePin(); });
    expect(result.current.ui.cmpA).toBeNull();
    expect(result.current.ui.say?.text).toBe('Baseline A pins a past date: travel there first (T), then press P.');
  });

  it('pins the travelled date; travelling to B compares once per (A, B, scan); back to now compares with now; unpin clears', () => {
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData())));
    act(() => { result.current.dispatch({ type: 'asOf', date: A }); });
    act(() => { result.current.m.pinA(); });
    expect(result.current.ui.cmpA).toBe(A);
    expect(result.current.ui.say?.text).toContain('Baseline A pinned');
    expect(result.current.m.comparison).toBeNull(); // A = B
    act(() => { result.current.dispatch({ type: 'asOf', date: Bd }); });
    const c = result.current.m.comparison!;
    expect([c.a, c.b]).toEqual([A, Bd]);
    expect(c.ids.length).toBeGreaterThan(0);
    act(() => { result.current.dispatch({ type: 'viewDays', days: 14 }); });
    expect(result.current.m.comparison).toBe(c);
    act(() => { result.current.dispatch({ type: 'asOf', date: null }); });
    expect(result.current.m.comparison!.b).toBe(asOf);
    act(() => { result.current.m.togglePin(); });
    expect(result.current.ui.cmpA).toBeNull();
    expect(result.current.m.comparison).toBeNull();
    expect(result.current.ui.say?.text).toBe('Comparison off.');
  });
});

describe('readiness for any scope (G)', () => {
  const R = plan.L.rooms[0]!, W = R.wing, T0 = R.bays[0]!.tiles[0]!;

  it('scope priority: the selection, the open feature, the room (a bay is its room), the wing, the whole product', () => {
    expect(readyScopeOf(plan.L, { picked: [T0.id, T0.id], sheet: R.feats[1]!.id, chain: { room: R.id } })).toMatchObject({ kind: 'selection', ids: [T0.id], label: { n: 1, name: T0.f.name } });
    expect(readyScopeOf(plan.L, { picked: [], sheet: T0.id, chain: { room: R.id } })).toMatchObject({ kind: 'feature', id: T0.id, ids: [T0.id] });
    expect(readyScopeOf(plan.L, { picked: [], sheet: null, chain: { wing: W.id, room: R.id } })).toMatchObject({ kind: 'room', id: R.id, label: { letter: W.def.letter } });
    expect(readyScopeOf(plan.L, { picked: [], sheet: null, chain: { wing: W.id, bay: R.bays[0]!.id } })!.kind).toBe('room');
    expect(readyScopeOf(plan.L, { picked: [], sheet: null, chain: { wing: W.id } })).toMatchObject({ kind: 'wing', id: W.id });
    const site = readyScopeOf(plan.L, { picked: ['not-on-the-plan'], sheet: null, chain: {} })!;
    expect(site.kind).toBe('site');
    expect(site.ids).toHaveLength(plan.L.bld.feats.length);
  });

  it('G opens readiness on the room in view, computes it, and G again closes it', () => {
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData())));
    result.current.view.level = { n: 2, wing: W.id, room: R.id, lodHigh: false };
    act(() => { result.current.m.toggleReady(); });
    expect(result.current.ui.ready?.kind).toBe('room');
    const r = result.current.m.readiness!;
    expect(r.scope.ids).toEqual(R.feats.map((f) => f.id));
    expect(r.result.n).toBe(R.feats.length);
    expect(r.result.maxAgeDays).toBe(30);
    act(() => { result.current.m.toggleReady(); });
    expect(result.current.ui.ready).toBeNull();
    expect(result.current.m.readiness).toBeNull();
  });

  it('with a selection G reads the picked items\' features; with an open feature it flies to it', () => {
    const items = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData()))).result.current.work.items.slice(0, 2);
    const sel = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData()), { selected: items.map((p) => p.id) }));
    act(() => { sel.result.current.m.toggleReady(); });
    expect(sel.result.current.ui.ready).toMatchObject({ kind: 'selection', ids: [...new Set(items.map((p) => p.fid))] });
    const nav = navStub();
    const open = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData()), { sheet: T0.id }, nav));
    act(() => { open.result.current.m.toggleReady(); });
    expect(open.result.current.ui.ready).toMatchObject({ kind: 'feature', id: T0.id });
    expect(nav.flyToFeature).toHaveBeenCalledWith(T0.id);
  });
});

describe('the trouble walk (N / Shift+N)', () => {
  it('steps the frozen route, says each arrival once the camera rests, and counts a member that turned bad as new', async () => {
    vi.useFakeTimers();
    const bad = turnBad(base, clean.id, lens0);
    const nav = navStub(), act0 = actionsOf(async () => bad);
    const { result } = renderHook(() => useHarness(kettleData(), act0, {}, nav));
    const n = result.current.m.trouble.all().filter((f) => plan.L.TILE[f.id]).length;
    act(() => { result.current.walk.stepWalk(1); });
    const w1 = result.current.walk.walk!;
    expect(w1).toMatchObject({ view: 'general', at: 1, n });
    expect(nav.flyToFeature).toHaveBeenLastCalledWith(w1.fid);
    expect(result.current.said).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(REST_MS + 1); });
    expect(result.current.said[0]).toMatch(new RegExp(`^1 of ${n} · `));
    // the clean feature turns bad mid-walk: not spliced in, announced as new
    await act(async () => { await result.current.reload(); });
    act(() => { result.current.walk.stepWalk(1); });
    expect(result.current.walk.walk).toMatchObject({ at: 2, n });
    act(() => { vi.advanceTimersByTime(REST_MS + 1); });
    expect(result.current.said[1]).toMatch(new RegExp(`^2 of ${n} · 1 new · `));
    act(() => { result.current.walk.stepWalk(-1); });
    expect(result.current.walk.walk!.at).toBe(1);
  });

  it('an empty lens says no trouble and starts nothing', () => {
    const quiet = plan.lenses.find((d) => !plan.S.features.some((f) => f.trouble.some((t) => t.lens === d.id)));
    const view = quiet?.id ?? 'no-such-lens';
    const nav = navStub();
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData()), { lens: view }, nav));
    act(() => { result.current.walk.stepWalk(1); });
    expect(result.current.walk.walk).toBeNull();
    expect(nav.flyToFeature).not.toHaveBeenCalled();
    expect(result.current.ui.say?.text).toMatch(/^No feature is in trouble under .+ now\.$/);
  });

  it('opening another feature ends the walk; the stop\'s own sheet keeps it', () => {
    const { result } = renderHook(() => useHarness(kettleData(), actionsOf(async () => kettleData())));
    act(() => { result.current.walk.stepWalk(1); });
    const fid = result.current.walk.walk!.fid;
    act(() => { result.current.dispatch({ type: 'openSheet', fid }); });
    expect(result.current.walk.walk?.fid).toBe(fid);
    act(() => { result.current.walk.stepWalk(1); }); // ignored while a sheet is open
    expect(result.current.walk.walk?.at).toBe(1);
    const other = plan.L.tiles.find((t) => t.id !== fid)!.id;
    act(() => { result.current.dispatch({ type: 'openSheet', fid: other }); });
    expect(result.current.walk.walk).toBeNull();
  });
});

describe('the spoken plan', () => {
  it('waits for the camera to rest, then says the place once; the same place is not said twice in a row', () => {
    vi.useFakeTimers();
    let still = -1, place = 'Room A';
    const say = vi.fn();
    const sp = new SpokenPlan({ still: () => still, place: () => place, say });
    sp.saySoon();
    vi.advanceTimersByTime(REST_MS * 3);
    expect(say).not.toHaveBeenCalled(); // still flying
    still = REST_MS;
    vi.advanceTimersByTime(REST_MS + 1);
    expect(say).toHaveBeenCalledWith('Room A');
    sp.saySoon(); vi.advanceTimersByTime(REST_MS + 1);
    expect(say).toHaveBeenCalledTimes(1);
    sp.saySoon(() => '1 of 3 · arrival'); vi.advanceTimersByTime(REST_MS + 1);
    expect(say).toHaveBeenLastCalledWith('1 of 3 · arrival');
    sp.saySoon(); vi.advanceTimersByTime(REST_MS + 1);
    expect(say).toHaveBeenLastCalledWith('Room A'); // an arrival in between: the place is said again
    place = 'Room B'; sp.saySoon(); sp.cancel(); vi.advanceTimersByTime(REST_MS + 1);
    expect(say).toHaveBeenCalledTimes(3);
  });
});
