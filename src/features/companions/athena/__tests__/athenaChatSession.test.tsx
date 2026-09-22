/**
 * Regression tests for the chat view's open-at-latest scroll.
 *
 * The bug: `AthenaChatBody` mounts with the staged `ready` gate still shut
 * (a skeleton renders instead of the scroll container), so the open-at-latest
 * effect fired against a null `scrollRef`, no-oped, stamped itself done, and
 * the panel opened parked at the FIRST message. The fix threads `ready`
 * through `useAthenaChatView` so the jump waits for the container to exist.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => {},
  toastCatch: () => () => {},
}));

import { useAthenaChatView } from '../chat/athenaChatSession';
import type { AthenaChatEngine } from '../chat/athenaChatEngine';

/** Synchronous rAF so the double-rAF settle runs inside `act`. */
beforeEach(() => {
  invokeMock.mockReset();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

function makeEngine(over: Partial<AthenaChatEngine> = {}): AthenaChatEngine {
  return {
    messages: [],
    streaming: false,
    initialized: true,
    activeConversationId: 'conv-1',
    ...over,
  } as AthenaChatEngine;
}

/** A fake scroll container with measurable geometry and a spyable scrollTo. */
function makeScrollEl() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  const scrollTo = vi.fn();
  (el as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
  return { el, scrollTo };
}

describe('useAthenaChatView open-at-latest', () => {
  it('does not stamp the jump as done while ready is false, then jumps instantly once the container mounts', () => {
    const engine = makeEngine();
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useAthenaChatView(engine, ready),
      { initialProps: { ready: false } },
    );

    // Skeleton phase: no container yet, nothing to scroll.
    expect(result.current.scrollRef.current).toBeNull();

    // The mount gate opens and the container exists in the same commit.
    const { el, scrollTo } = makeScrollEl();
    act(() => {
      result.current.scrollRef.current = el;
      rerender({ ready: true });
    });

    // Instant jump ('auto', never smooth) to the very bottom.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  });

  it('re-lands at the bottom when the active conversation switches', () => {
    let engine = makeEngine();
    const { result, rerender } = renderHook(
      ({ e }: { e: AthenaChatEngine }) => useAthenaChatView(e, true),
      { initialProps: { e: engine } },
    );

    const { el, scrollTo } = makeScrollEl();
    act(() => {
      result.current.scrollRef.current = el;
      rerender({ e: engine });
    });
    scrollTo.mockClear();

    engine = makeEngine({ activeConversationId: 'conv-2' });
    act(() => {
      rerender({ e: engine });
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  });

  it('does not re-jump on later renders of the same conversation', () => {
    const engine = makeEngine();
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useAthenaChatView(engine, ready),
      { initialProps: { ready: false } },
    );
    const { el, scrollTo } = makeScrollEl();
    act(() => {
      result.current.scrollRef.current = el;
      rerender({ ready: true });
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ ready: true });
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
