/**
 * Started builds, live (/perfect wave 1, direction 3), on the mounted sheet over the fixture source. A fake fleet feed
 * (the system store's session registry, the one the app's own events keep warm) walks a start through
 * queued -> running -> done and -> failed; the last session of a start ending is exactly one reload; the queue row of a
 * building item says so until the start settles; an aborted run reads apart from a failed one.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { StartResult } from '../source';
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
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const fleet = (label: string, over: Partial<FleetSession> = {}, id = 's-' + label): FleetSession => ({
  id, state: 'running', exitCode: null, runLabel: `fleet-door:lens_scan:${label}`, createdAtMs: 1_000, lastActivityMs: 2_000, ...over,
} as FleetSession);
const feed = (...sessions: FleetSession[]) => act(() => { useSystemStore.setState({ fleetSessions: sessions }); });

let actions: ReturnType<typeof createFixtureActions>;
let results: StartResult[];
let idsOf: string[][];

/** Mount on an approved item's feature, press B twice, and return how many starts that opened. */
async function startBuilds() {
  const data = kettleData();
  const feature = data.scan.proposals.find((p) => p.status === 'approved')!.feature;
  // the drive has not reached the items yet: they stay approved in the store while the build is in flight
  let n = 0;
  const start = vi.spyOn(actions, 'start').mockImplementation(async () => ({ label: `personas:t-${++n}`, command: 'node drive.mjs execute', pid: 4000 + n }));
  render(<AppKeyboardProvider><BlueprintSheet data={kettleData()} actions={actions} onClose={vi.fn()} initialFeature={feature} /></AppKeyboardProvider>);
  await waitFor(() => expect(screen.getByTestId('blueprint-feature-sheet')).toBeTruthy());
  key('b');
  await screen.findByTestId('blueprint-armed');
  key('b');
  await waitFor(() => expect(start).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByTestId('blueprint-command').length).toBe(start.mock.calls.length));
  idsOf = start.mock.calls.map((c) => c[0].ids ?? []);
  results = await Promise.all(start.mock.results.map((r) => r.value as Promise<StartResult>));
}

const stateOf = (label = results[0]!.label) => document.querySelector<HTMLElement>(`[data-testid="blueprint-start-state"][data-label="${label}"]`)!;
const agentsRow = (label: string) => [...document.querySelectorAll('.wb-row')].find((r) => r.textContent?.includes(label)) as HTMLElement | undefined;

beforeEach(() => { actions = createFixtureActions(kettleData()); useSystemStore.setState({ fleetSessions: [] }); });
afterEach(() => { useSystemStore.setState({ fleetSessions: [] }); vi.clearAllMocks(); });

describe('a started build follows the fleet', () => {
  it('queued with no session, then running, then done; the Agents row and the console both say so', async () => {
    await startBuilds();
    const label = results[0]!.label;
    // the console prints the start the moment it is made: nothing in the fleet yet
    await waitFor(() => expect(stateOf().dataset.phase).toBe('queued'));
    feed(fleet(label));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('running'));
    fireEvent.click(screen.getByTestId('blueprint-rail').querySelector<HTMLButtonElement>('[data-k="agents"]')!);
    await waitFor(() => expect(agentsRow(label)).toBeTruthy());
    expect(agentsRow(label)!.querySelector('.st')!.className).toContain('running');
    feed(fleet(label, { state: 'exited', exitCode: 0 }));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('done'));
    expect(agentsRow(label)!.querySelector('.st')!.className).toContain('done');
  });

  it('a session that exits badly is failed, a parked one is waiting', async () => {
    await startBuilds();
    const label = results[0]!.label;
    feed(fleet(label, { state: 'awaiting_input' }));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('waiting'));
    feed(fleet(label, { state: 'exited', exitCode: 1 }));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('failed'));
  });

  it('all of a start\'s sessions exiting triggers exactly one reload', async () => {
    await startBuilds();
    const label = results[0]!.label;
    feed(fleet(label, {}, 'a'), fleet(label, {}, 'b'));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('running'));
    const refresh = vi.spyOn(actions, 'refresh');
    refresh.mockClear();
    feed(fleet(label, { state: 'exited', exitCode: 0 }, 'a'), fleet(label, {}, 'b'));
    await act(async () => { await Promise.resolve(); });
    expect(refresh).not.toHaveBeenCalled(); // one session left alive: not yet
    feed(fleet(label, { state: 'exited', exitCode: 0 }, 'a'), fleet(label, { state: 'exited', exitCode: 0 }, 'b'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    feed(fleet(label, { state: 'exited', exitCode: 0 }, 'a'), fleet(label, { state: 'exited', exitCode: 0 }, 'b'), fleet('personas:other'));
    await act(async () => { await Promise.resolve(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the queue row of a building item says building while its start is unsettled, and not after', async () => {
    await startBuilds();
    const label = results[0]!.label;
    const building = () => [...document.querySelectorAll<HTMLElement>('[data-building="true"]')];
    // a start with no session yet is still in flight
    await waitFor(() => expect(building().length).toBeGreaterThan(0));
    expect(building()[0]!.textContent).toMatch(/building/i);
    feed(fleet(label, { state: 'exited', exitCode: 0 }));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('done'));
    // the settled start's items no longer hold the mark
    expect(building().some((el) => idsOf[0]!.includes(el.dataset.item ?? ''))).toBe(false);
    // once every start has settled nothing is building
    feed(...results.map((x) => fleet(x.label, { state: 'exited', exitCode: 0 })));
    await waitFor(() => expect(building().length).toBe(0));
  });
});

describe('between a drive sessions', () => {
  const covering = (ids: string[], status: 'running' | 'done') => {
    const d = kettleData();
    d.scan.runs.push({ ...d.scan.runs[0]!, id: 'r-live', status, phase: 'execute', scope: { proposals: ids } } as never);
    return d;
  };

  it('every session exited while the store run still runs is not done; one reload; the run ending settles it', async () => {
    await startBuilds();
    const label = results[0]!.label;
    const ids = idsOf[0]!;
    const refresh = vi.spyOn(actions, 'refresh').mockImplementation(async () => covering(ids, 'running'));
    refresh.mockClear();
    feed(fleet(label));
    await waitFor(() => expect(stateOf().dataset.phase).toBe('running'));
    feed(fleet(label, { state: 'exited', exitCode: 0 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); // the exit edge, exactly once
    await act(async () => { await Promise.resolve(); });
    expect(stateOf().dataset.phase).toBe('running'); // never "done" while the store run covers its items
    const building = () => [...document.querySelectorAll<HTMLElement>('[data-building="true"]')].map((el) => el.dataset.item);
    expect(building().some((id) => ids.includes(id ?? ''))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    // the store run ends: the next read settles the start
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    vi.setSystemTime(Date.now() + 15_000);
    refresh.mockImplementation(async () => covering(ids, 'done'));
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(stateOf().dataset.phase).toBe('done'));
    expect(building().some((id) => ids.includes(id ?? ''))).toBe(false);
    vi.useRealTimers();
  });
});

describe('an aborted run', () => {
  it('is counted and worded apart from a failed one in the Agents panel', async () => {
    const data = kettleData();
    data.scan.runs[0]!.status = 'aborted';
    data.scan.runs[1]!.status = 'failed';
    render(<AppKeyboardProvider><BlueprintSheet data={data} actions={createFixtureActions(data)} onClose={vi.fn()} /></AppKeyboardProvider>);
    fireEvent.click(screen.getByTestId('blueprint-rail').querySelector<HTMLButtonElement>('[data-k="agents"]')!);
    await waitFor(() => expect(document.querySelector('.wb-agents')).toBeTruthy());
    const counts = [...document.querySelectorAll('.wb-strip .wb-count')].map((c) => [c.querySelector('span')!.textContent, c.querySelector('b')!.textContent]);
    expect(counts).toEqual(expect.arrayContaining([['failed', '1'], ['aborted', '1']]));
    const aborted = document.querySelector('.wb-row.st-aborted .st') as HTMLElement;
    expect(aborted.className).toContain('aborted');
    expect(aborted.textContent).toBe('aborted');
  });
});
