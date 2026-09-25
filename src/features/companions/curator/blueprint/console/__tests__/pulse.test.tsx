/**
 * The end of the photograph.
 *
 * Until 2026-09-25 `useCuratorLoop` read the runtime ONCE, on mount, and
 * nothing ever read it again: no interval, no listener. Measured against the
 * operator's live machine that day, her loop had dispatched three times and had
 * two workers running, and the console showed none of it - so "the loop is
 * broken" was the reasonable conclusion and the wrong one.
 *
 * Every test here is about the same thing from a different side: her
 * announcement reaches the hook, the payload is USED rather than triggering a
 * read that was already answered, the kinds that move the operator's lane
 * (and only those) spend an IPC, and a pulse the backend could not measure
 * re-reads rather than painting a zero.
 *
 * The negative assertion is the load-bearing one. A "listener that re-reads
 * everything on every pulse" passes every positive test in this file and
 * throws away the whole reason the runtime rides on the wire.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();
const listenMock = vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
  handlers.set(name, cb);
  return Promise.resolve(unlisten);
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';

import { CuratorPulseKind, useCuratorPulse } from '../curatorPulse';
import { __resetCuratorLoopForTests, useCuratorLoop } from '../useCuratorLoop';

import { runtime } from './fixture';

const PULSE = 'curator://pulse';

/** What the three doors answer, by command name. */
function answer(name: unknown): Promise<unknown> {
  if (name === 'curator_requests_list') return Promise.resolve([]);
  if (name === 'curator_skills_list') return Promise.resolve([]);
  if (name === 'curator_runtime_get') return Promise.resolve(runtime());
  return Promise.reject(new Error(`no stub for ${String(name)}`));
}

/** How many times one command has been invoked so far. */
const calls = (name: string) => invokeMock.mock.calls.filter((c) => c[0] === name).length;

function fire(kind: string, rt: CuratorRuntime | null) {
  act(() => {
    handlers.get(PULSE)?.({ payload: { kind, runtime: rt } });
  });
}

beforeEach(() => {
  handlers.clear();
  invokeMock.mockReset();
  listenMock.mockClear();
  unlisten.mockClear();
  useCuratorPulse.__resetForTests();
  // The warm slot is module scope by design, so without this a mount would
  // paint the previous test's answer and `loading` would never be true - and
  // `waitFor(loading === false)` would return before the mount read settled,
  // racing every assertion below against it.
  __resetCuratorLoopForTests();
  invokeMock.mockImplementation(answer);
});

describe('her pulse repaints the console without asking it anything', () => {
  it('takes the runtime OFF the event rather than reading it back', async () => {
    const { result } = renderHook(() => useCuratorLoop());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const reads = calls('curator_runtime_get');
    expect(reads).toBe(1); // the mount read, and only that

    fire(CuratorPulseKind.HALTED, runtime({ running: 0, haltedReason: 'quiet hours' }));

    await waitFor(() => expect(result.current.runtime?.haltedReason).toBe('quiet hours'));
    expect(result.current.runtime?.running).toBe(0);
    // THE POINT: the strip is current and no door was knocked on. A listener
    // that re-read here would pass the assertion above and buy nothing.
    expect(calls('curator_runtime_get')).toBe(reads);
    expect(calls('curator_requests_list')).toBe(1);
  });

  it('re-reads the operator lane when, and only when, a row of it moved', async () => {
    const { result } = renderHook(() => useCuratorLoop());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls('curator_requests_list')).toBe(1);

    // A brake and a reconcile touch no `curator_request` row.
    fire(CuratorPulseKind.SLEPT, runtime());
    fire(CuratorPulseKind.RESUMED, runtime());
    await waitFor(() => expect(result.current.runtime).not.toBeNull());
    expect(calls('curator_requests_list')).toBe(1);

    // A dispatch takes a request queued -> dispatched; a settle closes it.
    fire(CuratorPulseKind.DISPATCHED, runtime());
    await waitFor(() => expect(calls('curator_requests_list')).toBe(2));
    fire(CuratorPulseKind.SETTLED, runtime());
    await waitFor(() => expect(calls('curator_requests_list')).toBe(3));
  });

  it('re-reads everything when the pulse could not measure her', async () => {
    const { result } = renderHook(() => useCuratorLoop());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = calls('curator_runtime_get');

    // `runtime: null` is "something moved and this app could not say what". It
    // must never be drawn as a quiet loop, so the hook goes and asks.
    fire(CuratorPulseKind.HALTED, null);

    await waitFor(() => expect(calls('curator_runtime_get')).toBe(before + 1));
    // And it did not blank what it was already holding while asking.
    expect(result.current.runtime).not.toBeNull();
  });

  it('opens ONE native listener however many surfaces subscribe', async () => {
    const first = renderHook(() => useCuratorLoop());
    const second = renderHook(() => useCuratorLoop());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(listenMock.mock.calls.filter((c) => c[0] === PULSE).length).toBe(1);

    // And it lets go when the last one leaves: a lazy route unmounts whole.
    first.unmount();
    expect(unlisten).not.toHaveBeenCalled();
    second.unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
