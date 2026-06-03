import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollRestoration, clearScrollRestoration } from '../useScrollRestoration';

/**
 * jsdom has no layout, so scrollTop/scrollHeight/clientHeight need explicit
 * backing. This builds a div with a real settable scrollTop and fixed metrics.
 */
function makeScrollEl(scrollHeight: number, clientHeight: number): HTMLDivElement {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  document.body.appendChild(el);
  return el;
}

describe('useScrollRestoration', () => {
  beforeEach(() => {
    clearScrollRestoration();
    document.body.innerHTML = '';
    // Run rAF synchronously so save/restore are deterministic in tests.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('jumps to the top for a genuinely new (unseen) key', () => {
    const el = makeScrollEl(1000, 200);
    el.scrollTop = 123; // pretend the element already had an offset
    const { result } = renderHook(() => useScrollRestoration('new-context'));
    act(() => result.current(el));
    expect(el.scrollTop).toBe(0);
  });

  it('saves on scroll and restores the offset on remount with the same key', () => {
    const key = 'list:all';
    const el1 = makeScrollEl(1000, 200);
    const h1 = renderHook(() => useScrollRestoration(key));
    act(() => result1Attach(h1, el1)); // attach → unseen key → top
    el1.scrollTop = 350; // user scrolls
    act(() => el1.dispatchEvent(new Event('scroll'))); // save 350
    act(() => h1.result.current(null)); // detach saves too
    h1.unmount();

    // Remount: a fresh element, same key, restores the remembered offset.
    const el2 = makeScrollEl(1000, 200);
    const h2 = renderHook(() => useScrollRestoration(key));
    act(() => h2.result.current(el2));
    expect(el2.scrollTop).toBe(350);
  });

  it('clamps the restored offset to the available scroll range', () => {
    const key = 'list:short';
    // Save a large offset under a tall layout...
    const tall = makeScrollEl(2000, 200);
    const h1 = renderHook(() => useScrollRestoration(key));
    act(() => h1.result.current(tall));
    tall.scrollTop = 1500;
    act(() => tall.dispatchEvent(new Event('scroll')));
    h1.unmount();
    // ...then remount where the content is much shorter (maxTop = 300).
    const short = makeScrollEl(500, 200);
    const h2 = renderHook(() => useScrollRestoration(key));
    act(() => h2.result.current(short));
    expect(short.scrollTop).toBe(300);
  });

  it('starts a different key at the top even when another key is remembered', () => {
    const seen = makeScrollEl(1000, 200);
    const h1 = renderHook(() => useScrollRestoration('persona:a'));
    act(() => h1.result.current(seen));
    seen.scrollTop = 400;
    act(() => seen.dispatchEvent(new Event('scroll')));
    h1.unmount();

    const fresh = makeScrollEl(1000, 200);
    const h2 = renderHook(() => useScrollRestoration('persona:b'));
    act(() => h2.result.current(fresh));
    expect(fresh.scrollTop).toBe(0);
  });

  it('forwards the node into the provided ref', () => {
    const fwd: { current: HTMLElement | null } = { current: null };
    const el = makeScrollEl(500, 100);
    const { result } = renderHook(() => useScrollRestoration('fwd', fwd));
    act(() => result.current(el));
    expect(fwd.current).toBe(el);
    act(() => result.current(null));
    expect(fwd.current).toBeNull();
  });

  it('persists the outgoing key and restores the incoming key on a key change while mounted', () => {
    const el = makeScrollEl(2000, 200);
    const { result, rerender } = renderHook(({ k }) => useScrollRestoration(k), {
      initialProps: { k: 'tab-A' },
    });
    act(() => result.current(el)); // attach with tab-A → top
    el.scrollTop = 600;
    act(() => el.dispatchEvent(new Event('scroll'))); // save tab-A = 600

    act(() => rerender({ k: 'tab-B' })); // save tab-A, restore tab-B (unseen → top)
    expect(el.scrollTop).toBe(0);
    el.scrollTop = 900;
    act(() => el.dispatchEvent(new Event('scroll'))); // save tab-B = 900

    act(() => rerender({ k: 'tab-A' })); // restore tab-A
    expect(el.scrollTop).toBe(600);
  });

  it('is inert when key is undefined but still forwards the node', () => {
    const fwd: { current: HTMLElement | null } = { current: null };
    const el = makeScrollEl(1000, 200);
    el.scrollTop = 250;
    const { result } = renderHook(() => useScrollRestoration(undefined, fwd));
    act(() => result.current(el));
    // No key → no restoration touches the offset, but the ref is still wired.
    expect(el.scrollTop).toBe(250);
    expect(fwd.current).toBe(el);
  });
});

/** Tiny helper to keep the attach call readable in the save/restore test. */
function result1Attach(
  h: { result: { current: (n: HTMLElement | null) => void } },
  el: HTMLElement,
): void {
  h.result.current(el);
}
