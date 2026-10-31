/**
 * Following bp's shared focus in the sheet (spark roadmap S6, G5), over the window's follower (lens/bpFollower.ts) on a
 * fake FollowSource (no IPC, no bp):
 *  - the open sheet is a visible Blueprint surface: hello when it opens, forget when it closes; Follow sends `follow`
 *    (whoever moves), never a publish;
 *  - each row of the place table (bp docs/concepts/one-morning-brief/personas.md section 3.2) lands on the right node of
 *    the Kettle plan: the site at level 0, a wing at level 1, a room (a capability) at its bay, a bp bay `<cap>.<kind>` at
 *    its capability's bay, a feature on its L4 sheet;
 *  - an id the plan does not draw holds still and says so; a product Personas has not got says "Not in Personas: <slug>";
 *    a place on another Personas product opens the sheet there (the follower's `open`), and a sheet opened at a place
 *    (`place` on LensSheetRequest) lands on it;
 *  - bp down reads "bp offline" on the chip; bp coming back hears follow again.
 * The fixture source itself has no follower: its sheet shows no chip.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import type { FollowSource } from '../source';
import type { FocusPlace } from '../model/focus';
import { buildPlan } from '../model/plan';
import { BpFollower } from '../../lens/bpFollower';

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
    products: async () => [{ slug: 'kettle', name: 'Kettle', projectId: data.product.projectId }, { slug: 'pof', name: 'PoF', projectId: 'p-pof' }, { slug: 'atlas', name: 'Atlas' }],
  };
}

const open = vi.fn();
function mount(source?: FollowSource, initialPlace?: FocusPlace) {
  const follower = source ? new BpFollower(source, { open }) : undefined;
  const actions = { ...createFixtureActions(kettleData()), ...(follower ? { follow: follower } : {}) };
  return render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={() => {}} {...(initialPlace ? { initialPlace } : {})} /></AppKeyboardProvider>);
}
const level = () => document.querySelector('nav.bp-lv [aria-current="true"]')?.getAttribute('data-level');
const plan = buildPlan(data.structure, data.events);
/** Follow on, one place shared by bp's web. */
async function follow(place: Record<string, unknown>, rev = 9) {
  const src = fakeSource(async () => ({ online: true, view: view(rev, place) }));
  mount(src);
  await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
  act(() => { fireEvent.click(chip()); });
  return src;
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
    await waitFor(() => expect(src.moves).toContain('forget'), { timeout: 3000 });
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

  it('a place on another Personas product opens the sheet there, at the place', async () => {
    await follow({ product: 'pof', target: { kind: 'room', id: 'combat' } }, 6);
    await waitFor(() => expect(open).toHaveBeenCalledWith('p-pof', { product: 'pof', target: { kind: 'room', id: 'combat' } }));
  });

  it('a product Personas has not got holds still and says Not in Personas', async () => {
    await follow({ product: 'atlas', target: { kind: 'room', id: 'maps' } }, 7);
    await waitFor(() => expect(say()).toContain('Not in Personas: atlas'));
    expect(open).not.toHaveBeenCalled();
  });

  it('the place table: site at level 0, wing at 1, room and a bp bay at their capability bay (3)', async () => {
    const wing = plan.L.wings[1] ?? plan.L.wings[0]!, bay = plan.L.bays[2] ?? plan.L.bays[0]!;
    const rows: [Record<string, unknown>, string][] = [
      [{ product: 'kettle', target: { kind: 'wing', id: wing.id } }, '1'],
      [{ product: 'kettle' }, '0'],
      [{ product: 'kettle', target: { kind: 'room', id: bay.id } }, '3'],
      [{ product: 'kettle', target: { kind: 'site', id: 'kettle' } }, '0'],
      [{ product: 'kettle', target: { kind: 'room', id: `${bay.id}.screens` } }, '3'],
    ];
    let i = 0;
    const src = fakeSource(async () => ({ online: true, view: view(20 + i, rows[i]![0]) }));
    mount(src);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    act(() => { fireEvent.click(chip()); });
    for (; i < rows.length; i++) {
      const want = rows[i]![1];
      await waitFor(() => expect(level()).toBe(want), { timeout: 3000 });
    }
  });

  it('a sheet opened at a place (place on LensSheetRequest) lands on it', async () => {
    const fid = data.scan.proposals.find((p) => p.status === 'proposed')!.feature;
    const src = fakeSource(async () => ({ online: true, view: { rev: 0, shared: null, readers: [] } }));
    mount(src, { product: 'kettle', target: { kind: 'feature', id: fid }, say: 'Opened where bp is' });
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    expect(say()).toContain('Opened where bp is');
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
