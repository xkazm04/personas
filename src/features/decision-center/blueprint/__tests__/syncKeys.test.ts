/**
 * spark bp-sync WP2, the keys: P / G / N / Shift+N reach their verbs; Esc climbs in bp's order with the new layers in it
 * (the L4 sheet, then readiness, then the trouble walk, then the timeline panel, then the pinned baseline A, then time
 * travel); while a walk is active Enter opens its current stop, and on that stop's own sheet Enter is D14 again.
 */
import { describe, expect, it, vi } from 'vitest';
import { handle, type SheetKeyDeps } from '../controller/useSheetKeys';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import type { ReadyScope } from '../model/readyScope';
import { initialUi, type UiState } from '../state/uiState';

const plan = buildPlan(kettleData().structure, kettleData().events);
const SCOPE: ReadyScope = { kind: 'site', id: '', ids: ['x'], label: { name: 'Kettle', letter: null, n: 1 } };
const WALK = { view: 'general', at: 2, n: 5, fid: plan.L.tiles[0]!.id };

function deps(ui: Partial<UiState> = {}, walk: typeof WALK | null = null) {
  const sync = { togglePin: vi.fn(), unpinA: vi.fn(), toggleReady: vi.fn(), stepWalk: vi.fn(), endWalk: vi.fn(), walk };
  const nav = { toLevel: vi.fn(), openSheet: vi.fn(), closeSheet: vi.fn(), compare: vi.fn(), select: vi.fn(), step: vi.fn(), wing: vi.fn(), zoom: vi.fn(), flyToFeature: vi.fn(), flyToPlace: vi.fn() };
  const d = {
    plan, ui: { ...initialUi(), ...ui }, dispatch: vi.fn(), sync, levelNow: () => 2, nav, writes: { disarm: vi.fn(), confirm: vi.fn() },
    current: null, onClose: vi.fn(), takeRecommended: vi.fn(() => true), sayEnterHint: vi.fn(),
  };
  return d as typeof d & SheetKeyDeps;
}
const ev = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: key === 'N', target: null, preventDefault() {} }) as unknown as KeyboardEvent;
const press = (d: SheetKeyDeps, key: string) => handle(d, ev(key), false);

describe('the new keys reach their verbs', () => {
  it('P toggles the baseline, G readiness, N and Shift+N step the walk', () => {
    const d = deps();
    press(d, 'p'); press(d, 'g'); press(d, 'n'); press(d, 'N');
    expect(d.sync.togglePin).toHaveBeenCalledTimes(1);
    expect(d.sync.toggleReady).toHaveBeenCalledTimes(1);
    expect(d.sync.stepWalk.mock.calls).toEqual([[1], [-1]]);
  });
});

describe('Esc climbs one layer per press (bp order)', () => {
  it('with A pinned and nothing else open, Esc unpins', () => {
    const d = deps({ cmpA: '2026-09-01', asOf: '2026-10-01' });
    press(d, 'Escape');
    expect(d.sync.unpinA).toHaveBeenCalledTimes(1);
    expect(d.dispatch).not.toHaveBeenCalledWith({ type: 'asOf', date: null });
  });
  it('the timeline panel closes before A is unpinned', () => {
    const d = deps({ cmpA: '2026-09-01', timelineOpen: true });
    press(d, 'Escape');
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'timeline', open: false });
    expect(d.sync.unpinA).not.toHaveBeenCalled();
  });
  it('time travel ends only after A is unpinned', () => {
    const d = deps({ asOf: '2026-10-01' });
    press(d, 'Escape');
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'asOf', date: null });
  });
  it('readiness closes before the walk ends and before A is unpinned', () => {
    const d = deps({ ready: SCOPE, cmpA: '2026-09-01' }, WALK);
    press(d, 'Escape');
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'ready', scope: null });
    expect(d.sync.endWalk).not.toHaveBeenCalled();
    expect(d.sync.unpinA).not.toHaveBeenCalled();
  });
  it('Esc from the opened stop returns to the walk (position kept); Esc on the plan ends it', () => {
    const open = deps({ sheet: WALK.fid }, WALK);
    press(open, 'Escape');
    expect(open.nav.closeSheet).toHaveBeenCalledTimes(1);
    expect(open.sync.endWalk).not.toHaveBeenCalled();
    const plain = deps({}, WALK);
    press(plain, 'Escape');
    expect(plain.sync.endWalk).toHaveBeenCalledTimes(1);
    expect(plain.nav.toLevel).not.toHaveBeenCalled();
  });
  it('with nothing open Esc still climbs a level', () => {
    const d = deps();
    press(d, 'Escape');
    expect(d.nav.toLevel).toHaveBeenCalledWith(1);
  });
});

describe('Enter while walking', () => {
  it('opens the current stop on the plan, not a level down', () => {
    const d = deps({}, WALK);
    press(d, 'Enter');
    expect(d.nav.openSheet).toHaveBeenCalledWith(WALK.fid);
    expect(d.nav.toLevel).not.toHaveBeenCalled();
    expect(d.takeRecommended).not.toHaveBeenCalled();
  });
  it("on the stop's own sheet takes the recommended answer (D14)", () => {
    const d = deps({ sheet: WALK.fid }, WALK);
    press(d, 'Enter');
    expect(d.takeRecommended).toHaveBeenCalledTimes(1);
    expect(d.nav.openSheet).not.toHaveBeenCalled();
  });
  it('without a walk, D14 is unchanged on a sheet and Enter descends on the plan', () => {
    const s = deps({ sheet: WALK.fid });
    press(s, 'Enter');
    expect(s.takeRecommended).toHaveBeenCalledTimes(1);
    const p = deps();
    press(p, 'Enter');
    expect(p.nav.toLevel).toHaveBeenCalledWith(3);
  });
});
