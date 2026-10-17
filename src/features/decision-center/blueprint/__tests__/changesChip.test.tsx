/**
 * The "N changed" chip on the mounted sheet (/perfect wave 2, direction 6): it appears when a re-read finds news, says
 * each entry in words newest first, goes to what an entry names, clears when opened, and the canvas is idle again once
 * the highlight has decayed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { Engine } from '../engine/Engine';
import type { EngineWords } from '../engine/types';
import { buildPlan } from '../model/plan';
import { FLASH_MS } from '../engine/changed';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';

let draws = 0;
beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), clearRect: () => { draws++; } } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** The next read: two waiting proposals decided elsewhere, and a run that ended. */
function news() {
  const d = kettleData();
  const waiting = d.scan.proposals.filter((p) => p.status === 'proposed');
  waiting[0]!.status = 'approved';
  waiting[1]!.status = 'declined';
  return { d, ids: [waiting[0]!.id, waiting[1]!.id] };
}

async function mount() {
  const initial = kettleData();
  initial.scan.runs[0]!.status = 'running';
  delete initial.scan.runs[0]!.ended_at;
  const actions = createFixtureActions(initial);
  render(<AppKeyboardProvider><BlueprintSheet data={initial} actions={actions} onClose={vi.fn()} /></AppKeyboardProvider>);
  await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
  return actions;
}

async function deliver(actions: Awaited<ReturnType<typeof mount>>, d: ReturnType<typeof kettleData>) {
  vi.spyOn(actions, 'refresh').mockImplementation(async () => d);
  vi.setSystemTime(Date.now() + 15_000);
  await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
}

describe('the changes chip', () => {
  it('shows nothing until the store moves, then counts, lists in words, goes to an entry and clears', async () => {
    const actions = await mount();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    expect(screen.queryByTestId('blueprint-changes-chip')).toBeNull();

    const flash = vi.spyOn(Engine.prototype, 'flash');
    const { d, ids } = news();
    d.scan.runs[0]!.status = 'done';
    await deliver(actions, d);
    const chip = await screen.findByTestId('blueprint-changes-chip');
    expect(chip.textContent).toContain('3 changed');
    expect(flash).toHaveBeenCalledTimes(1);

    fireEvent.click(chip);
    const list = await screen.findByTestId('blueprint-changes-list');
    const rows = within(list).getAllByRole('menuitem');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent).join('|')).toMatch(/Approved: .*\|.*Declined: |Declined: .*\|.*Approved: /);
    expect(rows.some((r) => /^Run done: /.test(r.textContent ?? ''))).toBe(true);
    // opening cleared the pending count: the chip counts what the list shows, and a closed list leaves none
    const approved = rows.find((r) => r.textContent?.startsWith('Approved: '))!;
    fireEvent.click(approved);
    await waitFor(() => expect(screen.queryByTestId('blueprint-changes-list')).toBeNull());
    expect(screen.queryByTestId('blueprint-changes-chip')).toBeNull();
    const row = document.querySelector(`[data-item="${ids[0]}"]`);
    expect(row?.getAttribute('aria-current')).toBe('true');

    // the same rows delivered again announce nothing
    await deliver(actions, d);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('blueprint-changes-chip')).toBeNull();
  });

  it('Esc closes the open list and nothing else', async () => {
    const actions = await mount();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    await deliver(actions, news().d);
    fireEvent.click(await screen.findByTestId('blueprint-changes-chip'));
    const list = await screen.findByTestId('blueprint-changes-list');
    fireEvent.keyDown(within(list).getAllByRole('menuitem')[0]!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('blueprint-changes-list')).toBeNull());
    expect(screen.getByTestId('blueprint-sheet')).toBeTruthy();
  });
});

describe('the canvas is idle again once the highlight has decayed', () => {
  it('draws no frame for the highlight beyond its time, and none at all when nothing changed', () => {
    const data = kettleData();
    const plan = buildPlan(data.structure, data.events);
    const host = document.createElement('div');
    const cv = document.createElement('canvas');
    host.appendChild(cv);
    const e = new Engine(cv, host, plan, {} as unknown as EngineWords, {
      safe: () => ({ l: 8, t: 80, r: 84, b: 84 }), moved: () => {}, hover: () => {}, flag: () => {}, click: () => {}, descend: () => {},
    });
    // the page's rAF loop would race the manual frames below
    cancelAnimationFrame((e as unknown as { raf: number }).raf);
    const tick = (t: number) => (e as unknown as { tick(t: number): void }).tick(t);
    let t = 10_000;
    for (let i = 0; i < 6; i++) { tick(t); t += 400; }
    const base = draws;
    for (let i = 0; i < 20; i++) { tick(t); t += 16; }
    expect(draws).toBe(base);

    e.flash(['book-a-class']);
    const before = draws;
    for (let i = 0; i < Math.ceil(FLASH_MS / 16) + 12; i++) { tick(t); t += 16; }
    expect(draws - before).toBeGreaterThan(50);
    expect(draws - before).toBeLessThanOrEqual(Math.ceil(FLASH_MS / 16) + 3);
    const done = draws;
    for (let i = 0; i < 30; i++) { tick(t); t += 16; }
    expect(draws).toBe(done);
    e.dispose();
  });
});
