/**
 * The live sheet on the mounted drawing (/perfect wave 1, direction 1): a re-read that finds nothing new causes zero
 * `Engine.setWork` calls (no canvas re-raster), and one that finds a change reaches the canvas once.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { Engine } from '../engine/Engine';
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
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the mounted sheet re-reads without redrawing', () => {
  it('an identical read calls setWork zero times; a changed one reaches the canvas', async () => {
    const actions = createFixtureActions(kettleData());
    render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={vi.fn()} /></AppKeyboardProvider>);
    await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
    const setWork = vi.spyOn(Engine.prototype, 'setWork');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const refresh = vi.spyOn(actions, 'refresh');

    // window focus after a quiet spell: the sheet re-reads, the read is identical
    vi.setSystemTime(Date.now() + 15_000);
    refresh.mockImplementation(async () => kettleData());
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(setWork).not.toHaveBeenCalled();

    // the next read finds a run that finished: one setWork
    vi.setSystemTime(Date.now() + 15_000);
    refresh.mockImplementation(async () => { const d = kettleData(); d.scan.runs[0]!.status = 'aborted'; return d; });
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(setWork).toHaveBeenCalledTimes(1));
  });
});
