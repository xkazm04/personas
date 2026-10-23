/**
 * The timeline, mounted (spark bp-fidelity, WP-D2), on the fixture source: the strip's TIMELINE press and T open the
 * expanded panel (key plan, clock, revisions chart) and T closes it; a key on the revisions slider travels a week back
 * (`ui.asOf`), the strip turns to its travelled state with BACK TO NOW, and BACK TO NOW returns to now; Esc closes the
 * panel first, then leaves the travelled date. The canvas is a stub (the page harness exercises the frame loop).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';

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

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const mount = () => render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={createFixtureActions(kettleData())} onClose={() => {}} /></AppKeyboardProvider>);

describe('the timeline', () => {
  it('opens the panel from the strip press and T, and T closes it', () => {
    mount();
    expect(screen.queryByTestId('blueprint-timeline-panel')).toBeNull();
    const strip = screen.getByTestId('blueprint-timeline');
    const toggle = strip.querySelector<HTMLButtonElement>('.tl-exp')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => { fireEvent.click(toggle); });
    expect(screen.getByTestId('blueprint-timeline-panel')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    key('t');
    expect(screen.queryByTestId('blueprint-timeline-panel')).toBeNull();
    key('t');
    expect(screen.getByTestId('blueprint-timeline-panel')).toBeTruthy();
  });

  it('travels a week back from the revisions slider, shows the travelled strip, and BACK TO NOW returns', () => {
    mount();
    key('t');
    const slider = screen.getByTestId('blueprint-revisions');
    const total = Number(slider.getAttribute('aria-valuemax'));
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(total);
    expect(screen.queryByTestId('blueprint-back-to-now')).toBeNull();
    act(() => { fireEvent.keyDown(slider, { key: 'ArrowLeft' }); });
    act(() => { fireEvent.keyDown(slider, { key: 'ArrowLeft' }); });
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(total - 2);
    expect(screen.getByTestId('blueprint-timeline').className).toContain('travel');
    act(() => { fireEvent.click(screen.getByTestId('blueprint-back-to-now')); });
    expect(screen.queryByTestId('blueprint-back-to-now')).toBeNull();
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(total);
  });

  it('keeps the slider keys from the sheet: an arrow on it travels and never walks the queue', () => {
    mount();
    key('t');
    const slider = screen.getByTestId('blueprint-revisions');
    act(() => { fireEvent.keyDown(slider, { key: 'ArrowDown' }); });
    expect(screen.getByTestId('blueprint-timeline').className).toContain('travel');
    act(() => { fireEvent.keyDown(slider, { key: 'End' }); });
    expect(screen.getByTestId('blueprint-timeline').className).not.toContain('travel');
  });

  it('climbs on Esc: the panel closes first, then the travelled date returns to now', () => {
    mount();
    key('t');
    act(() => { fireEvent.keyDown(screen.getByTestId('blueprint-revisions'), { key: 'Home' }); });
    key('Escape');
    expect(screen.queryByTestId('blueprint-timeline-panel')).toBeNull();
    expect(screen.getByTestId('blueprint-timeline').className).toContain('travel');
    key('Escape');
    expect(screen.getByTestId('blueprint-timeline').className).not.toContain('travel');
  });
});
