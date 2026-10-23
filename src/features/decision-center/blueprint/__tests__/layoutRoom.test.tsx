/**
 * Room to work (spark one-control, wave 1, direction 7): an open flyout narrows the plan, the lens strip says what it
 * cuts off, and the safe area stays below the crumb line.
 *  - the safe area's right inset is the flyout's measured width while it is open and 0 once it is closed;
 *  - the inset is 0 when the plan would keep less than MIN_PLAN_W beside the flyout;
 *  - the lens strip exposes every lens at a narrow width: what is cut off is counted on a chip.
 * Same canvas stubs as railFlyouts.test.tsx.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { SAFE, safeOf } from '../ui/PlanCanvas';
import { FLY_ATTR, MIN_PLAN_W, flyInset } from '../ui/flyRoom';
import { overflowOf } from '../ui/lensOverflow';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

const rect = (left: number, top: number, w: number, h: number) => ({ x: left, y: top, left, top, right: left + w, bottom: top + h, width: w, height: h, toJSON() {} }) as DOMRect;
const TAB_W = 76, STRIP_W = 300;

beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => vi.restoreAllMocks());

describe('safeOf: the room a flyout takes', () => {
  /** A plan 1000 x 700 with a laid-out 58 px title block and the flyout's reported width (or none). */
  function plan(fly?: number, planW = 1000) {
    const el = document.createElement('div');
    el.className = 'bp-plan';
    el.innerHTML = '<header class="bp-hd"><div class="bp-l2"></div></header><div class="bp-host"></div>';
    if (fly !== undefined) el.setAttribute(FLY_ATTR, String(fly));
    document.body.appendChild(el);
    const at: Record<string, DOMRect> = { 'bp-plan': rect(0, 0, planW, 700), 'bp-hd': rect(14, 8, 400, 58), 'bp-l2': rect(14, 40, 300, 24) };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return at[this.className] ?? rect(0, 0, 0, 0); });
    return { el, host: el.querySelector<HTMLElement>('.bp-host')! };
  }
  afterEach(() => { document.body.innerHTML = ''; });

  it('equals the flyout width while it is open and is 0 when it is closed', () => {
    const open = plan(340);
    expect(safeOf(open.host).r).toBe(SAFE.r + 340);
    open.el.setAttribute(FLY_ATTR, '0');
    expect(safeOf(open.host).r).toBe(SAFE.r);
    open.el.removeAttribute(FLY_ATTR);
    expect(safeOf(open.host).r).toBe(SAFE.r);
  });

  it('is 0 when the plan would keep less than MIN_PLAN_W beside the flyout (the panel lies over it)', () => {
    const narrow = plan(840, 970);
    expect(safeOf(narrow.host).r).toBe(SAFE.r);
    expect(flyInset(840, 970)).toBe(0);
    expect(flyInset(1020, 1020 + MIN_PLAN_W)).toBe(1020);
    expect(flyInset(1020, 1020 + MIN_PLAN_W - 1)).toBe(0);
  });

  it('keeps the top below the crumb line, with room for the wing title the plan draws under it', () => {
    const p = plan();
    expect(safeOf(p.host).t).toBe(Math.max(SAFE.t, 64 + 24));
  });
});

describe('overflowOf: the sheets the strip cuts off', () => {
  const tabs = Array.from({ length: 9 }, (_, i) => ({ left: i * TAB_W, right: (i + 1) * TAB_W }));
  it('counts what is cut off on each side and how far to scroll to bring the nearest one in', () => {
    const o = overflowOf({ left: 0, right: STRIP_W }, tabs);
    expect(o).toEqual({ before: 0, after: 6, toBefore: 0, toAfter: 4 * TAB_W - STRIP_W });
    const mid = overflowOf({ left: 100, right: 100 + STRIP_W }, tabs);
    expect(mid.before).toBeGreaterThan(0);
    expect(mid.toBefore).toBeLessThan(0);
  });
  it('says nothing when every tab is in view', () => {
    expect(overflowOf({ left: 0, right: 9 * TAB_W }, tabs)).toEqual({ before: 0, after: 0, toBefore: 0, toAfter: 0 });
  });
});

describe('in the sheet', () => {
  let actions: ReturnType<typeof createFixtureActions>;
  beforeEach(() => { actions = createFixtureActions(kettleData()); });
  const mount = () => render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={vi.fn()} /></AppKeyboardProvider>);
  const item = (k: string) => screen.getByTestId('blueprint-rail').querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!;
  const planEl = () => document.querySelector<HTMLElement>('.bp-plan')!;

  it('the open flyout reports its measured width on the plan, and gives it back when closed', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('bp-fly') ? 412 : 0; });
    mount();
    expect(planEl().getAttribute(FLY_ATTR)).toBeNull();
    fireEvent.click(item('agents'));
    await waitFor(() => expect(planEl().getAttribute(FLY_ATTR)).toBe('412'));
    fireEvent.click(item('agents'));
    await waitFor(() => expect(document.querySelector('[data-testid="blueprint-flyout"]')).toBeNull());
    expect(planEl().getAttribute(FLY_ATTR)).toBe('0');
  });

  it('the lens strip exposes every lens at a narrow width: what is cut off is counted on a chip', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'blueprint-lens-tabs') return rect(0, 0, STRIP_W, 54);
      if (this.dataset.lens) { const i = [...document.querySelectorAll('[data-lens]')].indexOf(this); return rect(i * TAB_W, 0, TAB_W, 54); }
      return rect(0, 0, 1000, 700);
    });
    mount();
    const strip = screen.getByTestId('blueprint-lens-tabs');
    const all = strip.querySelectorAll('[data-lens]').length;
    expect(all).toBeGreaterThan(Math.floor(STRIP_W / TAB_W));
    const chip = await screen.findByTestId('blueprint-lens-more-after');
    const cut = all - Math.floor(STRIP_W / TAB_W);
    expect(chip.textContent).toBe(String(cut));
    expect(chip.getAttribute('aria-label')).toContain(String(cut));
    expect(screen.queryByTestId('blueprint-lens-more-before')).toBeNull();
  });
});
