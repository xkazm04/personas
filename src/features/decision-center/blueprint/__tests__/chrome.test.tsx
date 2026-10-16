/**
 * bp's chrome, re-ported (spark bp-fidelity, Stage A, WP-A2), on the fixture source:
 *  - the project switcher lists every product with its readiness shape and word; a drawable row hands its id to
 *    `actions.openProduct`, a missing one does not switch, and Esc inside the menu closes the menu, never the sheet;
 *  - the last-scan pill is mint under an hour, amber past a day or never scanned;
 *  - the rail's Review item is the Build queue's toggle; a lens tab selects its sheet.
 * Same canvas stubs as sheet.test.tsx: the engine's frame loop is the page harness's job.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { scanTone } from '../ui/header/LivePill';

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
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

let actions: ReturnType<typeof createFixtureActions>;
let openProduct: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  actions = createFixtureActions(kettleData());
  openProduct = vi.fn();
  actions.openProduct = openProduct;
  onClose = vi.fn();
});

function mount() {
  return render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={onClose} /></AppKeyboardProvider>);
}

const trigger = () => screen.getByTestId('blueprint-project-switcher').querySelector<HTMLButtonElement>('.projsw-btn')!;
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-project="${id}"]`)!;

describe('the project switcher', () => {
  it('lists every product with its readiness, the open one checked', async () => {
    mount();
    fireEvent.click(trigger());
    const menu = await screen.findByTestId('blueprint-project-menu');
    expect(menu.querySelectorAll('[role="menuitemradio"]').length).toBe(4);
    expect(row('fixture-kettle').getAttribute('aria-checked')).toBe('true');
    expect(row('fixture-harbor').getAttribute('aria-disabled')).toBe('true');
    expect(row('fixture-lantern').querySelector('[data-level="measured"]')).toBeTruthy();
    expect(row('fixture-harbor').querySelector('[data-level="missing"]')).toBeTruthy();
  });

  it('hands a drawable product to actions.openProduct and never switches to a missing one', async () => {
    mount();
    fireEvent.click(trigger());
    await screen.findByTestId('blueprint-project-menu');
    fireEvent.click(row('fixture-harbor'));
    expect(openProduct).not.toHaveBeenCalled();
    fireEvent.click(row('fixture-lantern'));
    expect(openProduct).toHaveBeenCalledWith('fixture-lantern');
    expect(screen.queryByTestId('blueprint-project-menu')).toBeNull();
  });

  it('Esc in the menu closes the menu, not the sheet', async () => {
    mount();
    fireEvent.click(trigger());
    const menu = await screen.findByTestId('blueprint-project-menu');
    act(() => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByTestId('blueprint-project-menu')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('blueprint-sheet')).toBeTruthy();
  });
});

describe('the last-scan pill', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it('is mint under an hour, plain within a day, amber past a day or never scanned', () => {
    expect(scanTone('2026-10-15T11:30:00Z', now)).toBe('on');
    expect(scanTone('2026-10-15T02:00:00Z', now)).toBe('');
    expect(scanTone('2026-10-13T12:00:00Z', now)).toBe('off');
    expect(scanTone(null, now)).toBe('off');
  });
});

describe('the rail and the tabs', () => {
  it('Review toggles the Build queue', async () => {
    mount();
    const review = document.querySelector<HTMLButtonElement>('[data-k="review"]')!;
    expect(review.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.bp-side')).toBeTruthy();
    fireEvent.click(review);
    await waitFor(() => expect(document.querySelector('.bp-side')).toBeNull());
    expect(document.querySelector('[data-k="view"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('a lens tab selects its sheet', async () => {
    mount();
    const tabs = screen.getByTestId('blueprint-lens-tabs');
    const second = tabs.querySelectorAll<HTMLButtonElement>('.bp-tab-b')[1]!;
    fireEvent.click(second);
    await waitFor(() => expect(second.getAttribute('aria-pressed')).toBe('true'));
    expect(tabs.querySelector('[data-lens="general"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});
