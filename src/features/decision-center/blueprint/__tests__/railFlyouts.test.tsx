/**
 * bp's rail flyouts, re-ported (spark bp-fidelity, Stage C), on the fixture source:
 *  - Agents, Plan and View each open their own flyout; one at a time; pressing the open item closes it; the item that
 *    is open says so (aria-expanded); Esc closes it through the sheet's ladder;
 *  - Agents lists the store's runs and reads one in full; Plan's overview holds the Legend with every stage;
 *  - View's window writes `viewDays` (the title block and the rail follow it).
 * Same canvas stubs as chrome.test.tsx: the engine's frame loop is the page harness's job.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { LEGEND_STAGES } from '../ui/legend/Legend';

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
beforeEach(() => { actions = createFixtureActions(kettleData()); });

function mount() {
  return render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={vi.fn()} /></AppKeyboardProvider>);
}
const item = (k: string) => screen.getByTestId('blueprint-rail').querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!;
const flyout = () => document.querySelector<HTMLElement>('[data-testid="blueprint-flyout"]');

describe('the rail opens its flyouts', () => {
  it('opens one at a time, marks the open item, and the item again closes it', async () => {
    mount();
    expect(flyout()).toBeNull();
    fireEvent.click(item('agents'));
    await waitFor(() => expect(flyout()?.dataset.k).toBe('agents'));
    expect(item('agents').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(item('plan'));
    await waitFor(() => expect(flyout()?.dataset.k).toBe('plan'));
    expect(document.querySelectorAll('[data-testid="blueprint-flyout"]').length).toBe(1);
    expect(item('agents').getAttribute('aria-expanded')).toBe('false');
    expect(item('plan').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(item('plan'));
    await waitFor(() => expect(flyout()).toBeNull());
  });

  it('View is enabled and Esc closes its flyout, the sheet stays', async () => {
    mount();
    expect(item('view').hasAttribute('disabled')).toBe(false);
    fireEvent.click(item('view'));
    await waitFor(() => expect(flyout()?.dataset.k).toBe('view'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(flyout()).toBeNull());
    expect(screen.getByTestId('blueprint-sheet')).toBeTruthy();
  });

  it('the Esc chip closes it', async () => {
    mount();
    fireEvent.click(item('agents'));
    const f = await waitFor(() => { const el = flyout(); expect(el).toBeTruthy(); return el!; });
    fireEvent.click(within(f).getByRole('button', { name: /close the panel/i }));
    await waitFor(() => expect(flyout()).toBeNull());
  });

  it('Review still toggles the Build queue column, not a flyout', async () => {
    mount();
    fireEvent.click(item('review'));
    await waitFor(() => expect(document.querySelector('.bp-side')).toBeNull());
    expect(flyout()).toBeNull();
  });
});

describe('the panels', () => {
  it('Agents lists every run in the store and reads one in full', async () => {
    mount();
    fireEvent.click(item('agents'));
    const f = await waitFor(() => { const el = flyout(); expect(el).toBeTruthy(); return el!; });
    const runs = kettleData().scan.runs;
    const rows = f.querySelectorAll<HTMLElement>('[data-row^="run:"]');
    expect(rows.length).toBe(runs.length);
    fireEvent.click(rows[0]!);
    const newest = runs.slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]!;
    await waitFor(() => expect(f.querySelector('.wb-detail .wb-kick')?.textContent).toContain(newest.id));
  });

  it('Plan shows the Legend with every stage', async () => {
    mount();
    fireEvent.click(item('plan'));
    const legend = await screen.findByTestId('blueprint-legend-stages');
    const stages = Array.from(legend.querySelectorAll<HTMLElement>('[data-stage]')).map((e) => e.dataset.stage);
    expect(stages).toEqual([...LEGEND_STAGES]);
    expect(screen.getByTestId('blueprint-tbk')).toBeTruthy();
  });

  it('View writes the window: the rail and the title block follow viewDays', async () => {
    mount();
    expect(item('view').textContent).toContain('7d');
    fireEvent.click(item('view'));
    const seg = await screen.findByTestId('blueprint-view-window');
    const fourteen = seg.querySelector<HTMLButtonElement>('[data-days="14"]')!;
    expect(seg.querySelector('[data-days="7"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(fourteen);
    await waitFor(() => expect(fourteen.getAttribute('aria-pressed')).toBe('true'));
    expect(item('view').textContent).toContain('14d');
    fireEvent.click(seg.querySelector<HTMLButtonElement>('[data-days="1"]')!);
    await waitFor(() => expect(item('view').textContent).toContain('24h'));
  });
});
