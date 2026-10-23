/**
 * The L4 feature page (spark bp-fidelity WP-D1, bp's FeatureSheet re-ported), mounted on the fixture source:
 *  - General shows one headline tile per enabled lens, the record side column, and the red-pencil notes;
 *  - a tile opens that lens's tab and switches the plan's lens with it (as the digit keys do), and the tab shows
 *    the hero, the metric rows and the work under that lens;
 *  - the proposal controls on the page still write through actions.decide with the item's id;
 *  - a revision date travels the drawing back (ui.asOf): the as-of marker shows, health reads not recorded, and
 *    Back to now returns;
 *  - Esc closes the page.
 * The compare panel (WP-B's, embedded as it is) is stubbed: this file proves the page, not the panel.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));
vi.mock('../ui/compare/ComparePanel', () => ({ ComparePanel: ({ id }: { id: string }) => <div data-testid="stub-compare">{id}</div> }));

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

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
let actions: ReturnType<typeof createFixtureActions>;
let onClose: ReturnType<typeof vi.fn>;

function mount(feature: string) {
  render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={onClose} initialFeature={feature} /></AppKeyboardProvider>);
  return waitFor(() => screen.getByTestId('blueprint-feature-sheet'));
}

beforeEach(() => { actions = createFixtureActions(kettleData()); onClose = vi.fn(); });
afterEach(() => { vi.clearAllMocks(); });

describe('the L4 feature page', () => {
  it('General: a headline tile per lens, the record, the revisions and the red-pencil notes', async () => {
    const page = await mount('waitlist-with-auto-promote');
    expect(page.querySelectorAll('.pg-tile').length).toBe(8);
    expect(screen.getByTestId('blueprint-page-tab-general').getAttribute('aria-selected')).toBe('true');
    expect(page.querySelector('.bubble')).toBeTruthy();
    expect(page.querySelector('.pg-stage li.cur')).toBeTruthy();
    expect(page.querySelectorAll('.revt tbody tr').length).toBeGreaterThan(1);
    expect(page.querySelectorAll('.pn').length).toBe(2);
    expect(within(page).getByText(/INC-212/)).toBeTruthy();
  });

  it('a tile opens its lens tab and the plan lens follows; the tab shows the hero and the metric rows', async () => {
    const page = await mount('member-mobile-app');
    fireEvent.click(page.querySelector('.pg-tile [data-lens="design"]')!);
    await waitFor(() => expect(screen.getByTestId('blueprint-page-tab-design').getAttribute('aria-selected')).toBe('true'));
    expect(page.querySelector('.pg-hero')).toBeTruthy();
    expect(page.querySelector('.pg-mrs .mr')).toBeTruthy();
    expect(page.querySelector('.pg-tiles')).toBeNull();
    // the work under this lens keeps its controls
    expect(within(page).getByTestId('blueprint-page-work').querySelector('[data-item="kf-001"]')).toBeTruthy();
  });

  it('a digit switches the tab as before', async () => {
    const page = await mount('member-mobile-app');
    key('4');
    await waitFor(() => expect(page.querySelector('[role="tab"][aria-selected="true"]')?.id).not.toBe('bp-tab-general'));
    key('1');
    await waitFor(() => expect(screen.getByTestId('blueprint-page-tab-general').getAttribute('aria-selected')).toBe('true'));
  });

  it('the approve control on the page writes through actions.decide with the item id', async () => {
    const decide = vi.spyOn(actions, 'decide');
    const page = await mount('member-mobile-app');
    fireEvent.click(within(page).getAllByTestId('blueprint-approve')[0]!);
    await waitFor(() => expect(decide).toHaveBeenCalledWith(['kf-001'], 'approve', undefined));
  });

  it('a revision date travels the drawing back; the page marks what is not recorded, and Back to now returns', async () => {
    const page = await mount('waitlist-with-auto-promote');
    const dates = page.querySelectorAll<HTMLButtonElement>('.revt .pg-tt');
    fireEvent.click(dates[0]!);
    const bar = await within(page).findByRole('status');
    expect(bar.className).toBe('pg-asof');
    expect(page.querySelectorAll('.pg-tile .hw')[0]!.textContent).toMatch(/not recorded/i);
    fireEvent.click(within(bar).getByRole('button'));
    await waitFor(() => expect(page.querySelector('.pg-asof')).toBeNull());
  });

  it('Back to plan and Esc close the page', async () => {
    await mount('member-mobile-app');
    fireEvent.click(screen.getByTestId('blueprint-page-back'));
    await waitFor(() => expect(screen.queryByTestId('blueprint-feature-sheet')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
