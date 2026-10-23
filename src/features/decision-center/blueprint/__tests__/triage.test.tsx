/**
 * The L4 sheet's compare panel and triage (WP4b), mounted on the fixture source:
 *  - a feature whose work is built opens with the compare panel: the verdict, the metric, the screens (through
 *    `actions.shotUrl`, revoked on unmount) and the commit (through `actions.commitDiff`, cut where the store cut it);
 *  - Y, R, S and U go through `actions.triage` with the right decision and note (R and S ask the note first);
 *  - a refusal is sent and shown, never pre-empted: a reopen with no prior status and an accept of a failed build
 *    without a note both reach the store, and the dock console prints the store's reason;
 *  - Esc closes the compare before the sheet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { isBuilt, packOrder, placeInPack } from '../model/triage';
import { buildWork } from '../model/work';

vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }) } as Record<string, unknown>, {
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

function mount(feature: string) {
  return render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={() => {}} initialFeature={feature} /></AppKeyboardProvider>);
}
async function compareOn(feature: string, id: string) {
  mount(feature);
  await waitFor(() => expect(screen.getByTestId('blueprint-compare').getAttribute('data-item')).toBe(id));
}

beforeEach(() => { actions = createFixtureActions(kettleData()); });
afterEach(() => { vi.clearAllMocks(); });

describe('the compare panel', () => {
  it('opens with a built feature: verdict, metric, screens and the commit of the item', async () => {
    const commit = vi.spyOn(actions, 'commitDiff');
    const shot = vi.spyOn(actions, 'shotUrl');
    await compareOn('book-a-class', 'p-1aab7a');
    const panel = screen.getByTestId('blueprint-compare');
    expect(panel.getAttribute('data-status')).toBe('done');
    expect(screen.getAllByTestId('blueprint-verdict').some((v) => v.getAttribute('data-verdict') === 'moved')).toBe(true);
    expect(screen.getByTestId('blueprint-metric').textContent).toMatch(/2.*1/);
    await waitFor(() => expect(commit).toHaveBeenCalledWith('7e377835952504b939cd4a70bbf71ebef5bbb1c0'));
    await waitFor(() => expect(shot).toHaveBeenCalled());
    expect(shot.mock.calls.every(([p]) => p.startsWith('sample-shots/des1-booking-'))).toBe(true);
    expect(await screen.findAllByTestId('blueprint-shot')).not.toHaveLength(0);
  });

  it('revokes the object URL of every screen it asked for when it unmounts', async () => {
    vi.spyOn(actions, 'shotUrl').mockImplementation(async (p) => 'blob:fixture/' + p);
    const revoke = vi.fn(), orig = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const view = mount('book-a-class');
      await screen.findAllByTestId('blueprint-shot');
      view.unmount();
      expect(revoke).toHaveBeenCalled();
      expect(revoke.mock.calls.every(([u]) => String(u).startsWith('blob:fixture/'))).toBe(true);
    } finally { URL.revokeObjectURL = orig; }
  });

  it('a performance item shows its baseline runs; its long commit says where the store cut it', async () => {
    await compareOn('drag-and-drop-timetable-editor', 'p-3cda72');
    expect(screen.getByTestId('blueprint-perf').textContent).toMatch(/96.*98.*104/);
    const commit = await screen.findByTestId('blueprint-commit');
    await waitFor(() => expect(commit.querySelectorAll('details').length).toBe(2));
    const patch = commit.querySelectorAll('details')[1]!;
    act(() => { patch.open = true; patch.dispatchEvent(new Event('toggle')); });
    expect((await screen.findByTestId('blueprint-patch-cut')).textContent).toMatch(/2,?000/);
  });

  it('Esc closes the compare first, then the sheet', async () => {
    await compareOn('book-a-class', 'p-1aab7a');
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-compare')).toBeNull());
    expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy();
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-feature-sheet')).toBeNull());
  });
});

describe('triage keys and controls', () => {
  it('Y accepts the item through actions.triage and the console prints the store answer', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await compareOn('book-a-class', 'p-1aab7a');
    key('y');
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a'], 'accept', undefined));
    const out = await screen.findByTestId('blueprint-triage-result');
    expect(out.textContent).toContain('accepted');
    expect(out.textContent).toContain('p-1aab7a');
    await waitFor(() => expect(screen.getByTestId('blueprint-compare').getAttribute('data-status')).toBe('accepted'));
  });

  it('R asks the note first, then sends rework with it', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await compareOn('book-a-class', 'p-1aab7a');
    key('r');
    const input = await screen.findByTestId('blueprint-reason-input');
    expect(triage).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Shoot the designed state' } });
    expect(screen.getByTestId('blueprint-reason-preview').textContent).toContain('triage(["p-1aab7a"], "rework", "Shoot the designed state")');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a'], 'rework', 'Shoot the designed state'));
  });

  it('S asks the note, then descopes; the Undo control (U) puts the item back', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await compareOn('book-a-class', 'p-1aab7a');
    key('s');
    const input = await screen.findByTestId('blueprint-reason-input');
    fireEvent.change(input, { target: { value: 'Not worth the risk now' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('blueprint-compare').getAttribute('data-status')).toBe('descoped'));
    expect(triage).toHaveBeenCalledWith(['p-1aab7a'], 'descope', 'Not worth the risk now');
    fireEvent.click(screen.getByTestId('blueprint-triage-reopen'));
    await waitFor(() => expect(triage).toHaveBeenLastCalledWith(['p-1aab7a'], 'reopen', undefined));
    await waitFor(() => expect(screen.getByTestId('blueprint-compare').getAttribute('data-status')).toBe('done'));
  });

  it('a refused reopen is sent and its reason shown: no prior status', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await compareOn('studio-kpi-dashboard', 'p-9c40b1');
    key('u');
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-9c40b1'], 'reopen', undefined));
    const skipped = await screen.findByTestId('blueprint-skipped');
    expect(skipped.getAttribute('data-reason')).toBe('no-prior-status');
    expect(skipped.textContent).toContain('no-prior-status');
    expect(skipped.textContent).toContain('nothing to undo');
    expect(screen.getByTestId('blueprint-compare').getAttribute('data-status')).toBe('accepted');
  });

  it('a descope of an item whose release left draft is refused in-release, and shown', async () => {
    await compareOn('revenue-reports', 'p-7e21a0');
    key('s');
    const input = await screen.findByTestId('blueprint-reason-input');
    fireEvent.change(input, { target: { value: 'later' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByTestId('blueprint-skipped')).getAttribute('data-reason')).toBe('in-release');
  });

  it('accepting a failed build asks a note; sent without one, the store refuses note-required and the console says so', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await compareOn('digital-waiver-signing', 'p-f9cf56');
    fireEvent.click(screen.getByTestId('blueprint-triage-accept'));
    const input = await screen.findByTestId('blueprint-reason-input');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-f9cf56'], 'accept', undefined));
    expect((await screen.findByTestId('blueprint-skipped')).getAttribute('data-reason')).toBe('note-required');
  });

  it('a store that throws is printed as a failed triage, and the item stays as the store has it', async () => {
    vi.spyOn(actions, 'triage').mockRejectedValueOnce(new Error('store locked'));
    await compareOn('book-a-class', 'p-1aab7a');
    key('y');
    expect((await screen.findAllByText(/store locked/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('blueprint-compare').getAttribute('data-status')).toBe('done');
  });
});

describe('the triage model', () => {
  const data = kettleData();
  const plan = buildPlan(data.structure, data.events);
  const work = buildWork(plan.L, data.scan);

  it('an after reading is never the feature\'s current state: the series skips every phased reading (bp check-release-train)', () => {
    const phased = data.scan.measurements.filter((m) => m.phase);
    expect(phased.length).toBeGreaterThan(0);
    for (const m of phased) expect(work.series(m.feature, m.lens, m.metric).some((x) => x.id === m.id)).toBe(false);
  });

  it('packOrder walks the built items packs oldest first, each pack as built; a lens keeps its own packs', () => {
    const order = packOrder(work);
    expect(order.every(isBuilt)).toBe(true);
    const packs = order.map((p) => p.pack);
    expect(packs.filter((k, i) => k !== packs[i - 1])).toEqual(data.scan.packs.map((k) => k.id));
    expect(packOrder(work, 'performance').map((p) => p.id)).toEqual(['p-3cda72', 'p-bd54ec']);
    expect(placeInPack(work, work.byId.get('p-bd54ec')!)).toEqual({ n: 2, of: 2 });
  });
});
