/**
 * Following bp's shared focus in the sheet (spark roadmap S6), over a fake FollowSource (no IPC, no bp):
 *  - the sheet says hello when it opens and forgets when it closes; Follow sends `follow` (whoever moves), never a
 *    publish;
 *  - a place on this product's plan is applied (a feature opens its L4 sheet); an id the plan does not draw holds still
 *    and the status line says so; a place on another product says so;
 *  - bp down reads "bp offline" on the chip.
 * The fixture source itself has no follow: its sheet shows no chip.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import type { FollowSource } from '../source';

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
afterEach(() => { vi.clearAllMocks(); });

const data = kettleData();
const view = (rev: number, place: Record<string, unknown>) => ({
  rev, shared: { place, reader: 'web:1', surface: 'web', label: 'Web', at: '2026-10-30T10:00:00.000Z' }, readers: [],
});

function fakeSource(read: FollowSource['read']): FollowSource & { moves: string[] } {
  const moves: string[] = [];
  return {
    reader: 'personas:main',
    moves,
    read,
    move: async (op) => { moves.push(op); return {}; },
    products: async () => [{ slug: 'kettle', name: 'Kettle', projectId: data.product.projectId }, { slug: 'pof', name: 'PoF' }],
  };
}

function mount(source?: FollowSource) {
  const actions = { ...createFixtureActions(kettleData()), ...(source ? { follow: source } : {}) };
  return render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={() => {}} /></AppKeyboardProvider>);
}
const chip = () => screen.getByTestId('blueprint-follow-chip');
const say = () => document.querySelector('.bp-say')?.textContent ?? '';

describe('Follow bp in the sheet', () => {
  it('the fixture has no follow source and shows no chip', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    expect(screen.queryByTestId('blueprint-follow-chip')).toBeNull();
  });

  it('says hello on open and forget on close; Follow sends follow, never a publish', async () => {
    const src = fakeSource(async () => ({ online: true, view: { rev: 0, shared: null, readers: [] } }));
    const r = mount(src);
    await waitFor(() => expect(src.moves).toContain('hello'));
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(src.moves).toContain('follow'));
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(src.moves).toContain('unfollow'));
    r.unmount();
    expect(src.moves).toContain('forget');
    expect(src.moves).not.toContain('publish');
  });

  it('a feature place on this product opens its L4 sheet', async () => {
    const fid = data.scan.proposals.find((p) => p.status === 'proposed')!.feature;
    const src = fakeSource(async () => ({ online: true, view: view(4, { product: 'kettle', target: { kind: 'feature', id: fid } }) }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    expect(chip().textContent).toContain('Web');
  });

  it('an id this plan does not draw holds still and says so', async () => {
    const src = fakeSource(async () => ({ online: true, view: view(5, { product: 'kettle', target: { kind: 'room', id: 'ghost.core' } }) }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(say()).toContain('ghost.core'));
    expect(screen.queryByTestId('blueprint-feature-sheet')).toBeNull();
  });

  it('a place on another product says so and stays', async () => {
    const src = fakeSource(async () => ({ online: true, view: view(6, { product: 'pof' }) }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(say()).toContain('pof'));
  });

  it('bp coming back hears follow again', async () => {
    let up = false;
    const src = fakeSource(async () => (up ? { online: true, view: { rev: 0, shared: null, readers: [] } } : { online: false }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(chip().getAttribute('data-online')).toBe('false'));
    up = true;
    await waitFor(() => expect(src.moves.filter((m) => m === 'follow')).toHaveLength(2), { timeout: 3000 });
  });

  it('bp down reads offline on the chip', async () => {
    const src = fakeSource(async () => ({ online: false, error: 'not running (connection refused)' }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    await waitFor(() => expect(chip().getAttribute('data-online')).toBe('false'));
  });
});
