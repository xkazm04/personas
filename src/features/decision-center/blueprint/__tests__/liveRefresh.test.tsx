/**
 * The live sheet (/perfect wave 1, direction 1): the sheet re-reads itself on an adaptive cadence, keeps the previous
 * data by identity when a read found nothing new, and never lets an older completion land over a newer one.
 * Fake timers drive the shared PollingCoordinator; `actions.refresh` is a scripted fake.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAST_MS, SLOW_MS, useLiveRefresh } from '../controller/useLiveRefresh';
import { mergeRead, useSheetData } from '../controller/useSheetData';
import { kettleData } from '../fixture/kettle';
import type { BlueprintActions, BlueprintData } from '../source';

const withRun = (d: BlueprintData, status: 'running' | 'done'): BlueprintData => {
  const next = structuredClone(d);
  next.scan.runs[0]!.status = status;
  if (status === 'running') delete next.scan.runs[0]!.ended_at;
  return next;
};

/** What the sheet controller wires: the read side plus the live refresh, fast while a store run runs. */
function useLive(initial: BlueprintData, actions: BlueprintActions, extraFast = false) {
  const d = useSheetData(initial, actions);
  const fast = extraFast || d.data.scan.runs.some((r) => r.status === 'running');
  useLiveRefresh({ reload: d.reload, readAt: d.readAt, fast });
  return d;
}

const actionsOf = (refresh: () => Promise<BlueprintData>) => ({ refresh: vi.fn(refresh) }) as unknown as BlueprintActions & { refresh: ReturnType<typeof vi.fn> };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('mergeRead', () => {
  it('an identical read is the previous object', () => {
    const prev = kettleData();
    expect(mergeRead(prev, kettleData())).toBe(prev);
  });

  it('a changed scan keeps the map, products and events by identity', () => {
    const prev = kettleData();
    const next = withRun(kettleData(), 'running');
    const merged = mergeRead(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.structure).toBe(prev.structure);
    expect(merged.events).toBe(prev.events);
    expect(merged.products).toBe(prev.products);
    expect(merged.scan.runs[0]!.status).toBe('running');
  });

  it('only the products list moved: the scan keeps its identity, so the work is not recomputed', () => {
    const prev = kettleData();
    const next = kettleData();
    next.products![0]!.proposals += 1;
    const merged = mergeRead(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.scan).toBe(prev.scan);
  });
});

describe('useSheetData.reload', () => {
  it('an identical read leaves data, plan and work untouched (the canvas has nothing to re-raster)', async () => {
    const initial = kettleData();
    const actions = actionsOf(async () => kettleData());
    const { result } = renderHook(() => useSheetData(initial, actions));
    const before = result.current;
    await act(async () => { await result.current.reload(); });
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(before.data);
    expect(result.current.plan).toBe(before.plan);
    expect(result.current.work).toBe(before.work);
  });

  it('a completion older than the newest read started is dropped (two overlapping reloads, reverse order)', async () => {
    const initial = kettleData();
    const gates: Array<(d: BlueprintData) => void> = [];
    const actions = actionsOf(() => new Promise<BlueprintData>((r) => { gates.push(r); }));
    const { result } = renderHook(() => useSheetData(initial, actions));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => { first = result.current.reload(); second = result.current.reload(); });
    await act(async () => { gates[1]!(withRun(kettleData(), 'running')); await second; });
    expect(result.current.data.scan.runs[0]!.status).toBe('running');
    await act(async () => { gates[0]!(kettleData()); await first; });
    // the older read (all runs done) resolved last and must not land over the fresher one
    expect(result.current.data.scan.runs[0]!.status).toBe('running');
  });

  it('a failed read keeps the held data and answers false', async () => {
    const initial = kettleData();
    const actions = actionsOf(async () => { throw new Error('store down'); });
    const { result } = renderHook(() => useSheetData(initial, actions));
    let ok = true;
    await act(async () => { ok = await result.current.reload(); });
    expect(ok).toBe(false);
    expect(result.current.data).toBe(initial);
  });
});

describe('useLiveRefresh', () => {
  it('a run that finished outside the sheet reads as finished within one fast cycle', async () => {
    const initial = withRun(kettleData(), 'running');
    const actions = actionsOf(async () => withRun(kettleData(), 'done'));
    const { result } = renderHook(() => useLive(initial, actions));
    expect(result.current.data.scan.runs[0]!.status).toBe('running');
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_MS + 50); });
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.data.scan.runs[0]!.status).toBe('done');
  });

  it('sweeps slowly when nothing runs, fast when a run does, and slow again once it ends', async () => {
    const initial = kettleData();
    let status: 'running' | 'done' = 'done';
    const actions = actionsOf(async () => withRun(kettleData(), status));
    renderHook(() => useLive(initial, actions));
    await act(async () => { await vi.advanceTimersByTimeAsync(SLOW_MS - 1_000); });
    expect(actions.refresh).not.toHaveBeenCalled();
    status = 'running';
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(actions.refresh).toHaveBeenCalledTimes(1); // the slow sweep found a running run
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_MS * 2 + 100); });
    expect(actions.refresh.mock.calls.length).toBeGreaterThanOrEqual(3); // now every fast cycle
    status = 'done';
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_MS + 100); });
    const settledCalls = actions.refresh.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_MS * 3); });
    expect(actions.refresh.mock.calls.length).toBe(settledCalls); // back on the slow sweep
  });

  it('an unsettled started build holds the fast cadence even with no store run', async () => {
    const actions = actionsOf(async () => kettleData());
    renderHook(() => useLive(kettleData(), actions, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(FAST_MS + 50); });
    expect(actions.refresh).toHaveBeenCalledTimes(1);
  });

  it('regaining window focus re-reads at once, unless a read finished under 10 s ago', async () => {
    const actions = actionsOf(async () => kettleData());
    renderHook(() => useLive(kettleData(), actions));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(actions.refresh).not.toHaveBeenCalled(); // the sheet was just read
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(actions.refresh).toHaveBeenCalledTimes(1); // throttled
  });

  it('a write reload still lands at once (the same reload the writes call)', async () => {
    const actions = actionsOf(async () => withRun(kettleData(), 'running'));
    const { result } = renderHook(() => useLive(kettleData(), actions));
    await act(async () => { await result.current.reload(); });
    expect(result.current.data.scan.runs[0]!.status).toBe('running');
  });
});
