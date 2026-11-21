/**
 * spark bp-sync WP3, the visible surfaces over WP2's sync state, on Kettle's dated readings:
 *  - Kettle's history: a travelled date replays pairs by today's rules, and a pinned A yields changes (health too);
 *  - the strip: PIN A when travelled, SINCE A · N CHANGED and UNPIN A when pinned, the replayed line; none at now;
 *  - the feature page's "Changed between A and B" for a feature in the comparison, nothing for one outside it;
 *  - "What clears it": verified steps, a chip on a covered step, none on an uncovered one;
 *  - the readiness callout for a scope, absent without one;
 *  - the hover card's place lines under a lens view (engine/place-words), the stage lines under General.
 * The sheet-level pieces render inside a hand-built Sheet value; the strip is also proven on the mounted sheet.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { SheetContext, type Sheet } from '../controller/SheetContext';
import { useBlueprintText, useEngineWords, type BlueprintText } from '../controller/useBlueprintText';
import type { EngineWords } from '../engine/types';
import { ReplayIndex } from '../engine/replay';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { compareDates, type Comparison } from '../model/compare';
import { buildPlan } from '../model/plan';
import { readiness } from '../model/ready';
import { readyScopeOf } from '../model/readyScope';
import { baseId } from '../model/timeview';
import { clearPath } from '../standard/clear';
import { coverStep } from '../standard/cover';
import { initialUi, type UiState } from '../state/uiState';
import { ClearSteps } from '../ui/page/ClearSteps';
import { CompareSection } from '../ui/page/Compare';
import { ReadyCallout } from '../ui/overlays/ReadyCallout';
import { PlaceBody } from '../ui/overlays/hoverBodies';
import { SyncPos } from '../ui/timeline/SyncPos';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  vi.stubGlobal('Path2D', class { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} });
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});
afterEach(() => { vi.clearAllMocks(); });

const data = kettleData(), plan = buildPlan(data.structure, data.events), asOf = plan.S.asOf, scan = data.scan;
const A = '2026-08-25', Bd = '2026-09-15';
const F = Object.fromEntries(plan.S.features.map((f) => [f.id, f]));
const words = (): { text: BlueprintText; W: EngineWords } => renderHook(() => { const text = useBlueprintText(); return { text, W: useEngineWords(text) }; }).result.current;

/** A Sheet value with what the WP3 surfaces read; the verbs are spies. */
function fakeSheet(over: { ui?: Partial<UiState>; comparison?: Comparison | null; ready?: Sheet['sync']['readiness'] } = {}): Sheet {
  const { text, W } = words();
  const sync = { comparison: over.comparison ?? null, readiness: over.ready ?? null, replayed: false, pinA: vi.fn(), unpinA: vi.fn(), toggleReady: vi.fn() };
  return {
    data, plan, text, words: W, engine: null, ui: { ...initialUi(), ...over.ui }, dispatch: vi.fn(),
    nav: { openSheet: vi.fn() }, sync,
  } as unknown as Sheet;
}
const withSheet = (s: Sheet, node: ReactNode) => render(<SheetContext.Provider value={s}>{node}</SheetContext.Provider>);

describe("Kettle's dated readings", () => {
  it('a travelled date replays at least one pair by today\'s rules; now replays none', () => {
    const rp = new ReplayIndex(plan.S.features, plan.lenses);
    rp.sync(asOf, asOf, scan);
    expect(rp.pairs).toBe(0);
    rp.sync(Bd, asOf, scan);
    expect(rp.pairs).toBeGreaterThan(0);
  });

  it('A pinned before the history and B after it yields changes, a replayed health move among them', () => {
    const c = compareDates(plan.S.features, plan.lenses, scan, A, Bd, asOf);
    expect(c.ids.length).toBeGreaterThan(0);
    const ab = compareDates(plan.S.features, plan.lenses, scan, '2026-08-20', '2026-09-10', asOf);
    expect(ab.counts.health).toBeGreaterThan(0);
    expect(ab.byId.get('card-payments')?.health.some((h) => h.lens === 'com.kettle.cost' && h.a === 'bad' && h.b === 'watch')).toBe(true);
  });
});

describe('the strip', () => {
  it('PIN A only when travelled; pinned: SINCE A · N CHANGED and UNPIN A', () => {
    const c = compareDates(plan.S.features, plan.lenses, scan, A, Bd, asOf);
    const atNow = withSheet(fakeSheet(), <SyncPos now />);
    expect(screen.queryByTestId('blueprint-pin-a')).toBeNull();
    atNow.unmount();
    const s = fakeSheet({ ui: { asOf: Bd } });
    const off = withSheet(s, <SyncPos now={false} />);
    act(() => { fireEvent.click(screen.getByTestId('blueprint-pin-a')); });
    expect(s.sync.pinA).toHaveBeenCalledTimes(1);
    off.unmount();
    const p = fakeSheet({ ui: { asOf: Bd, cmpA: A }, comparison: c });
    withSheet(p, <SyncPos now={false} />);
    expect(screen.getByTestId('blueprint-cmp-since').textContent).toContain(`${c.ids.length} changed`);
    act(() => { fireEvent.click(screen.getByTestId('blueprint-unpin-a')); });
    expect(p.sync.unpinA).toHaveBeenCalledTimes(1);
  });

  it('on the mounted sheet: travel, P pins, travel on, the strip counts the changes and says health is replayed', () => {
    render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={createFixtureActions(kettleData())} onClose={() => {}} /></AppKeyboardProvider>);
    act(() => { fireEvent.keyDown(window, { key: 't' }); });
    const slider = screen.getByTestId('blueprint-revisions');
    for (let i = 0; i < 7; i++) act(() => { fireEvent.keyDown(slider, { key: 'ArrowLeft' }); });
    expect(screen.getByTestId('blueprint-pin-a')).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    expect(screen.getByTestId('blueprint-cmp-since')).toBeTruthy();
    for (let i = 0; i < 3; i++) act(() => { fireEvent.keyDown(slider, { key: 'ArrowRight' }); });
    expect(Number(/(\d+) changed/i.exec(screen.getByTestId('blueprint-cmp-since').textContent ?? '')?.[1])).toBeGreaterThan(0);
    expect(screen.getByTestId('blueprint-replayed')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByTestId('blueprint-unpin-a')); });
    expect(screen.queryByTestId('blueprint-cmp-since')).toBeNull();
  });
});

describe('the feature page', () => {
  const c = compareDates(plan.S.features, plan.lenses, scan, '2026-08-20', '2026-09-10', asOf);
  it('"Changed between A and B" lists the lines of a feature in the comparison', () => {
    const s = fakeSheet({ comparison: c, ui: { cmpA: c.a, asOf: c.b } });
    withSheet(s, <CompareSection fid="card-payments" />);
    const sec = screen.getByTestId('blueprint-page-compare');
    expect(sec.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(sec.textContent).toContain('Cost health: bad on');
    expect(sec.textContent).toContain('(read ');
  });
  it('nothing for a feature outside the comparison, nothing without one', () => {
    const outside = plan.S.features.find((f) => !c.byId.has(f.id))!;
    withSheet(fakeSheet({ comparison: c }), <CompareSection fid={outside.id} />);
    withSheet(fakeSheet(), <CompareSection fid="card-payments" />);
    expect(screen.queryByTestId('blueprint-page-compare')).toBeNull();
  });

  // a (feature, lens) whose verified steps include one a proposal covers, and one with an uncovered step
  const pairs = plan.S.features.flatMap((f) => plan.lenses.map((d) => ({ f, d })))
    .filter(({ f, d }) => { const fl = f.lens[d.id]; return fl && (fl.h === 'watch' || fl.h === 'bad'); })
    .map(({ f, d }) => {
      const fl = f.lens[d.id]!, steps = clearPath(d.manifest, fl.v).steps;
      return { f, d, steps, covered: steps.filter((st) => coverStep(st, scan.proposals, fl.v, d.manifest, { feature: baseId(f.id), lens: d.id }).covered).length };
    });
  it('"What clears it" puts a chip on a covered step', () => {
    const hit = pairs.find((p) => p.covered > 0)!;
    expect(hit).toBeTruthy();
    withSheet(fakeSheet(), <ClearSteps f={hit.f} d={hit.d} />);
    const box = screen.getByTestId('blueprint-clear-steps');
    expect(box.querySelectorAll('li').length).toBe(hit.steps.length);
    expect(screen.getAllByTestId('blueprint-cover-chip').length).toBe(hit.covered);
  });
  it('a good reading near a worse bound states the margin (bp), with no steps', () => {
    const good = plan.S.features.find((f) => f.lens['com.kettle.cost']?.h === 'good' && (f.lens['com.kettle.cost']?.v.monthlyUsd as number) >= 300)!;
    withSheet(fakeSheet(), <ClearSteps f={good} d={plan.LENS['com.kettle.cost']!} />);
    const box = screen.getByTestId('blueprint-clear-steps');
    expect(box.querySelector('li')).toBeNull();
    expect(box.querySelector('.wrs')!.textContent).toMatch(/from watch \(past/);
  });
  it('an uncovered step has no chip, and a lens with nothing to clear shows nothing', () => {
    const bare = pairs.find((p) => p.steps.length > 0 && p.covered === 0)!;
    const r = withSheet(fakeSheet(), <ClearSteps f={bare.f} d={bare.d} />);
    expect(screen.getByTestId('blueprint-clear-steps').querySelectorAll('li').length).toBe(bare.steps.length);
    expect(screen.queryByTestId('blueprint-cover-chip')).toBeNull();
    r.unmount();
    // a pair with no reading (unmeasured) has nothing to clear and no margin to state
    const none = plan.S.features.find((f) => !f.lens['com.kettle.cost'] || f.lens['com.kettle.cost'].h === 'unmeasured')!;
    withSheet(fakeSheet(), <ClearSteps f={none} d={plan.LENS['com.kettle.cost']!} />);
    expect(screen.queryByTestId('blueprint-clear-steps')).toBeNull();
  });
});

describe('the readiness callout', () => {
  const sc = readyScopeOf(plan.L, { picked: [], sheet: null, chain: { wing: null, room: null, bay: null } })!;
  const result = readiness({ lenses: plan.lenses, F }, scan, sc.ids, { maxAgeDays: 30, now: asOf }, scan.proposals);
  it('names the scope, says the summary line and lists the rows; close calls G', () => {
    const s = fakeSheet({ ready: { scope: sc, result } });
    withSheet(s, <ReadyCallout />);
    const box = screen.getByTestId('blueprint-ready-callout');
    expect(box.textContent).toContain('Readiness · Whole product');
    expect(box.querySelector('.ready-line')!.textContent).toContain(`${result.n} features: ${result.clear} clear every lens`);
    if (result.steps) expect(box.textContent).toContain('Steps to clear');
    act(() => { fireEvent.click(screen.getByText('Close · G')); });
    expect(s.sync.toggleReady).toHaveBeenCalledTimes(1);
    const row = box.querySelector<HTMLButtonElement>('.lnk')!;
    act(() => { fireEvent.click(row); });
    expect(s.nav.openSheet).toHaveBeenCalledTimes(1);
  });
  it('absent without a scope, and over an open feature page', () => {
    withSheet(fakeSheet(), <ReadyCallout />);
    withSheet(fakeSheet({ ready: { scope: sc, result }, ui: { sheet: plan.S.features[0]!.id } }), <ReadyCallout />);
    expect(screen.queryByTestId('blueprint-ready-callout')).toBeNull();
  });
});

describe('the hover card over a place', () => {
  const room = plan.L.rooms.find((r) => r.feats.some((f) => f.lens.performance?.h === 'watch' || f.lens.performance?.h === 'bad'))!;
  it('under a lens view: the lens part (verdict, bad, to watch) from place-words', () => {
    withSheet(fakeSheet({ ui: { lens: 'performance' } }), <PlaceBody s={fakeSheet({ ui: { lens: 'performance' } })} o={room} />);
    expect(screen.getByTestId('blueprint-hov-parts').textContent).toMatch(/to watch|bad/);
  });
  it('under General: the stage parts, as before', () => {
    withSheet(fakeSheet(), <PlaceBody s={fakeSheet()} o={room} />);
    expect(screen.getByTestId('blueprint-hov-parts').textContent).toMatch(/live/);
  });
});
