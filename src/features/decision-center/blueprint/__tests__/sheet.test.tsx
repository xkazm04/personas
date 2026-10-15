/**
 * The sheet, mounted (WP4a), on the fixture source:
 *  - A on a proposed item (open + A, two keys from a Build card) goes through `actions.decide` and the dock console
 *    prints the store's own answer (the ids decided, each skipped row);
 *  - X asks the reason first, then declines with it as the note;
 *  - B arms the approved items, a second B starts one job per lens through `actions.start` (never approve-proposed);
 *  - Esc climbs (L4 sheet, then level by level) and only at the site closes the sheet, and the Decision Deck's own Esc
 *    handler, one rung below, never sees a press the sheet used.
 * The canvas is a stub: the engine's frame loop is exercised by the page harness (blueprintShots.mjs); here the
 * camera and the keys are real.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { DECK_PRIORITY } from '../../deck/keys';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';

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
  // reduced motion: the camera lands where it flies, so a press changes the level at once
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  // a real-sized plan, so the camera's levels mean something (jsdom lays nothing out)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

const data = kettleData();
const firstProposed = () => data.scan.proposals.find((p) => p.status === 'proposed')!;
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

let actions: ReturnType<typeof createFixtureActions>;
let deckEscape: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

/** Stands in for the Decision Deck behind the sheet: Esc at its priority (85), consumed. */
function FakeDeck() {
  useAppKeyboard((e) => { if (e.key === 'Escape') { deckEscape(); return true; } return false; }, { priority: DECK_PRIORITY });
  return null;
}

function mount(initialFeature?: string) {
  return render(<AppKeyboardProvider><FakeDeck /><BlueprintSheet data={kettleData()} actions={actions} onClose={onClose} initialFeature={initialFeature} /></AppKeyboardProvider>);
}

beforeEach(() => { actions = createFixtureActions(kettleData()); deckEscape = vi.fn(); onClose = vi.fn(); });
afterEach(() => { vi.clearAllMocks(); });

describe('BlueprintSheet', () => {
  it('opens on a feature: its L4 sheet shows the lens cards and the feature\'s proposals', async () => {
    const p = firstProposed();
    mount(p.feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    expect(document.querySelector(`[data-item="${p.id}"][data-status="proposed"]`)).toBeTruthy();
    expect(document.querySelectorAll('.bp-lc').length).toBe(8);
  });

  it('A approves the current item through actions.decide, and the console prints the store answer', async () => {
    const decide = vi.spyOn(actions, 'decide');
    const p = firstProposed();
    mount(p.feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('a');
    await waitFor(() => expect(decide).toHaveBeenCalledWith([p.id], 'approve', undefined));
    const out = await screen.findByTestId('blueprint-decide-result');
    expect(out.textContent).toContain(p.id);
    await waitFor(() => expect(document.querySelector(`[data-item="${p.id}"][data-status="approved"]`)).toBeTruthy());
  });

  it('prints each skipped row with the status the store gave it', async () => {
    const decide = vi.spyOn(actions, 'decide').mockResolvedValueOnce({ decision: 'approved', by: 'operator:test', decided: [], skipped: [{ id: firstProposed().id, status: 'executing' }] });
    const p = firstProposed();
    mount(p.feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('a');
    const out = await screen.findByTestId('blueprint-decide-result');
    expect(decide).toHaveBeenCalled();
    expect(out.textContent).toContain('executing');
  });

  it('X asks the reason, then declines with it as the note', async () => {
    const decide = vi.spyOn(actions, 'decide');
    const p = firstProposed();
    mount(p.feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('x');
    const input = await screen.findByTestId('blueprint-reason-input');
    expect(decide).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Superseded by the redesign' } });
    expect(screen.getByTestId('blueprint-reason-preview').textContent).toContain('Superseded by the redesign');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(decide).toHaveBeenCalledWith([p.id], 'decline', 'Superseded by the redesign'));
  });

  it('B arms the approved items; a second B starts one job per lens and prints the command', async () => {
    const start = vi.spyOn(actions, 'start');
    mount(firstProposed().feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('b');
    await screen.findByTestId('blueprint-armed');
    expect(start).not.toHaveBeenCalled();
    key('b');
    await waitFor(() => expect(start).toHaveBeenCalled());
    const approved = data.scan.proposals.filter((p) => p.status === 'approved');
    const lenses = new Set(approved.map((p) => p.lens));
    expect(start).toHaveBeenCalledTimes(lenses.size);
    for (const call of start.mock.calls) {
      const req = call[0];
      expect(req.action).toBe('execute');
      expect(req.ids?.every((id) => approved.some((p) => p.id === id && p.lens === req.lens))).toBe(true);
    }
    const cmd = await screen.findAllByTestId('blueprint-command');
    expect(cmd[0]!.textContent).toContain('drive.mjs execute');
  });

  it('Esc disarms an armed build first and starts nothing', async () => {
    const start = vi.spyOn(actions, 'start');
    mount(firstProposed().feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('b');
    await screen.findByTestId('blueprint-armed');
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-armed')).toBeNull());
    expect(start).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy();
  });

  it('Esc climbs the L4 sheet, then the levels, and only then closes; the deck behind never sees the press', async () => {
    mount(firstProposed().feature);
    await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-feature-sheet')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    let presses = 1;
    for (; presses < 10 && onClose.mock.calls.length === 0; presses++) key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(presses).toBeGreaterThan(2);
    expect(deckEscape).not.toHaveBeenCalled();
  });

  it('the key sheet opens on ? and any key closes it without closing the sheet', async () => {
    mount();
    await screen.findByTestId('blueprint-sheet');
    key('?');
    await screen.findByText(/one keymap/i);
    key('z');
    await waitFor(() => expect(screen.queryByText(/one keymap/i)).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
