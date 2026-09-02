/**
 * ONE BAD CONSUMER MUST NOT STARVE THE OTHERS.
 *
 * `createSingletonListener` is the single native `listen()` behind the Event
 * Log, the Live Stream, the Monitor relay panels and the structured execution
 * stream. `src/hooks/realtime/` was the only hook directory under `src/hooks/`
 * with no `__tests__`, so none of its load-bearing behaviour was pinned:
 *
 *  1. The per-frame flush fanned out with NO try/catch. A subscriber that threw
 *     aborted the rAF callback, so every subscriber later in the Set missed that
 *     payload AND the rest of the batch vanished silently — `frameQueue` had
 *     already been emptied. One buggy panel could starve three surfaces at once.
 *  2. The refcounted acquire/release, the StrictMode single-attach guard, the
 *     early-arrival buffer cap and its drop accounting, and FIFO order across a
 *     flush were all invariants held by nothing.
 *
 * The tests run with `requestAnimationFrame` stubbed away so the singleton's
 * documented `queueMicrotask` fallback drives the flush — deterministic in
 * jsdom without a fake-timer rAF shim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { createSingletonListener } from '../createSingletonListener';

const listenMock = vi.mocked(listen);

type Payload = { n: number };

let nativeHandler: EventCallback<Payload> | null = null;
let unlistenSpy: ReturnType<typeof vi.fn>;
let listenResolvers: Array<() => void>;
let deferListen = false;

/** Deliver a payload the way the Tauri runtime would. */
function emitNative(n: number) {
  nativeHandler?.({ event: 'test-event', id: n, payload: { n } });
}

/** Drain the queueMicrotask flush and any React state it produced. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  nativeHandler = null;
  listenResolvers = [];
  deferListen = false;
  unlistenSpy = vi.fn();
  // The queueMicrotask fallback (createSingletonListener.ts) keeps the flush
  // deterministic; jsdom's rAF is not.
  vi.stubGlobal('requestAnimationFrame', undefined);
  listenMock.mockReset();
  listenMock.mockImplementation((async (_name: string, cb: EventCallback<Payload>) => {
    nativeHandler = cb;
    if (deferListen) {
      await new Promise<void>((resolve) => listenResolvers.push(resolve));
    }
    return unlistenSpy;
  }) as unknown as typeof listen);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSingletonListener — native listener lifecycle', () => {
  it('attaches exactly one native listener across a StrictMode double-mount', async () => {
    const useTestListener = createSingletonListener<Payload>('test-event');
    const seen: number[] = [];

    const view = renderHook(() => useTestListener((p) => seen.push(p.n)), {
      wrapper: StrictMode,
    });
    await flush();

    // StrictMode mounts, unmounts and remounts the effect. The setupInFlight
    // guard plus the shared setupPromise must collapse that into ONE listen().
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(unlistenSpy).not.toHaveBeenCalled();

    emitNative(1);
    await flush();
    // Exactly one subscriber survives the double-invoke, so one delivery.
    expect(seen).toEqual([1]);

    view.unmount();
    await flush();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the listener while any consumer remains and unlistens on the last one', async () => {
    const useTestListener = createSingletonListener<Payload>('test-event');

    const a = renderHook(() => useTestListener(() => {}));
    await flush();
    const b = renderHook(() => useTestListener(() => {}));
    await flush();

    // Refcounted acquire: the second consumer reuses the first's subscription.
    expect(listenMock).toHaveBeenCalledTimes(1);

    a.unmount();
    await flush();
    expect(unlistenSpy).not.toHaveBeenCalled();

    b.unmount();
    await flush();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  it('does not tear down while setup is still in flight', async () => {
    deferListen = true;
    const useTestListener = createSingletonListener<Payload>('test-event');

    const view = renderHook(() => useTestListener(() => {}));
    view.unmount();
    // The unlisten function does not exist yet; teardown must not throw or
    // detach a listener the runtime has not handed back.
    expect(unlistenSpy).not.toHaveBeenCalled();

    await act(async () => {
      listenResolvers.forEach((r) => r());
      await Promise.resolve();
      await Promise.resolve();
    });

    // Setup completes to zero subscribers and cleans itself up.
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createSingletonListener — delivery', () => {
  it('delivers a multi-payload batch in FIFO order across one flush', async () => {
    const useTestListener = createSingletonListener<Payload>('test-event');
    const seen: number[] = [];

    renderHook(() => useTestListener((p) => seen.push(p.n)));
    await flush();

    emitNative(1);
    emitNative(2);
    emitNative(3);

    await flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('contains a throwing subscriber: siblings and the rest of the batch still arrive', async () => {
    const useTestListener = createSingletonListener<Payload>('test-event');
    const good: number[] = [];
    const alsoGood: number[] = [];
    const thrown: number[] = [];

    renderHook(() =>
      useTestListener((p) => {
        thrown.push(p.n);
        throw new Error(`consumer exploded on ${p.n}`);
      }),
    );
    await flush();
    renderHook(() => useTestListener((p) => good.push(p.n)));
    await flush();
    renderHook(() => useTestListener((p) => alsoGood.push(p.n)));
    await flush();

    emitNative(1);
    emitNative(2);
    await flush();

    // The bad subscriber is first in the Set, so before containment it aborted
    // the whole rAF callback: `good`/`alsoGood` were empty and payload 2 was
    // lost with the already-emptied queue.
    expect(thrown).toEqual([1, 2]);
    expect(good).toEqual([1, 2]);
    expect(alsoGood).toEqual([1, 2]);

    // And the fan-out survives for the NEXT batch too.
    emitNative(3);
    await flush();
    expect(good).toEqual([1, 2, 3]);
  });
});

describe('createSingletonListener — early-arrival buffer', () => {
  it('caps the buffer at 50, counts the drops, and reports them to a late subscriber', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const useTestListener = createSingletonListener<Payload>('test-event');

    // Attach the native listener, then release the only consumer so later
    // payloads land in the early buffer instead of a subscriber.
    const primer = renderHook(() => useTestListener(() => {}));
    await flush();
    primer.unmount();
    await flush();

    for (let i = 1; i <= 60; i += 1) emitNative(i);

    const seen: number[] = [];
    const drops: number[] = [];
    renderHook(() => useTestListener((p) => seen.push(p.n), (t) => drops.push(t)));
    await flush();

    // MAX_BUFFER = 50 kept the OLDEST 50; the last 10 were dropped and counted.
    expect(seen).toHaveLength(50);
    expect(seen[0]).toBe(1);
    expect(seen[49]).toBe(50);
    // The drop total is surfaced to a subscriber that mounted after the fact —
    // otherwise the loss is invisible to every panel that arrives late.
    expect(drops).toEqual([10]);
    // One-shot warning, not one per dropped event.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('createSingletonListener — __resetForTests', () => {
  it('detaches the listener and clears buffers, counters and subscribers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const useTestListener = createSingletonListener<Payload>('test-event');

    const primer = renderHook(() => useTestListener(() => {}));
    await flush();
    primer.unmount();
    await flush();
    for (let i = 1; i <= 60; i += 1) emitNative(i);

    useTestListener.__resetForTests();

    // Nothing from the previous life leaks into the next consumer: no buffered
    // payloads, no carried-over drop count, and a fresh native attach.
    const seen: number[] = [];
    const drops: number[] = [];
    renderHook(() => useTestListener((p) => seen.push(p.n), (t) => drops.push(t)));
    await flush();

    expect(seen).toEqual([]);
    expect(drops).toEqual([]);
    expect(listenMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
